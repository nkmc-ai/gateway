import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createGateway } from "../../src/http/app.js";
import { D1RegistryStore } from "../../src/registry/d1-store.js";
import { SqliteD1 } from "../../src/testing/sqlite-d1.js";
import { generateGatewayKeyPair, createTestToken } from "@nkmc/core/testing";
import type { GatewayKeyPair } from "@nkmc/core";

const SKILL_MD = `---
name: "Acme Store"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme Store

E-commerce service for products and orders.

## Schema

### products (read: public / write: agent)

Product catalog

| field | type | description |
|-------|------|-------------|
| id | string | Product ID |
| name | string | Product name |
| price | number | Price in USD |

## API

### List products

\`GET /api/products\` — public

Returns all products.

### Create order

\`POST /api/orders\` — 0.05 USDC / call, agent

Creates a new order.
`;

const ADMIN_TOKEN = "e2e-admin-secret";

describe("Gateway E2E", () => {
  let keys: GatewayKeyPair;

  beforeAll(async () => {
    keys = await generateGatewayKeyPair();
  });

  let db: SqliteD1;
  let store: D1RegistryStore;

  beforeEach(async () => {
    db = new SqliteD1();
    store = new D1RegistryStore(db);
    await store.initSchema();
  });

  afterEach(() => {
    db.close();
  });

  function createApp() {
    return createGateway({
      store,
      gatewayPrivateKey: keys.privateKey,
      gatewayPublicKey: keys.publicKey,
      adminToken: ADMIN_TOKEN,
    });
  }

  it("full flow: register → list → auth → execute → fs", async () => {
    const app = createApp();

    // 1. Admin: Register service via skill.md
    const registerRes = await app.request(
      "/registry/services?domain=acme-store.com",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: SKILL_MD,
      },
    );
    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();
    expect(registerBody).toEqual({
      ok: true,
      domain: "acme-store.com",
      name: "Acme Store",
    });

    // 2. Admin: List services and verify
    const listRes = await app.request("/registry/services", {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ domain: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].domain).toBe("acme-store.com");

    // 3. Admin: Get service details
    const detailRes = await app.request(
      "/registry/services/acme-store.com",
      {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      },
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      domain: string;
      name: string;
      endpoints: Array<{ method: string; path: string }>;
    };
    expect(detail.name).toBe("Acme Store");
    expect(detail.endpoints.length).toBeGreaterThan(0);

    // 4. Auth: Obtain agent JWT
    const authRes = await app.request("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sub: "agent-42",
        svc: "acme-store.com",
        roles: ["agent"],
      }),
    });
    expect(authRes.status).toBe(200);
    const { token } = (await authRes.json()) as { token: string };
    expect(token).toBeTruthy();

    // 5. Agent: Execute ls / (shows registered domains)
    const execRes = await app.request("/execute", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "ls /" }),
    });
    expect(execRes.status).toBe(200);
    const execBody = (await execRes.json()) as {
      ok: boolean;
      data: string[];
    };
    expect(execBody.ok).toBe(true);
    // ls returns domain names with trailing slash
    expect(execBody.data).toContain("acme-store.com/");

    // 6. Agent: GET /fs/ (list root via REST)
    const fsRootRes = await app.request("/fs/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fsRootRes.status).toBe(200);
    const fsRootBody = (await fsRootRes.json()) as {
      ok: boolean;
      data: string[];
    };
    expect(fsRootBody.ok).toBe(true);
    expect(fsRootBody.data).toContain("acme-store.com/");
  });

  it("should persist services across requests via D1", async () => {
    const app = createApp();

    // Register two services
    for (const domain of ["svc-a.com", "svc-b.com"]) {
      const md = `---\nname: ${domain}\ngateway: nkmc\nversion: "1.0"\nroles: [agent]\n---\n# ${domain}\nService ${domain}.`;
      await app.request(`/registry/services?domain=${domain}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: md,
      });
    }

    // Verify both exist
    const listRes = await app.request("/registry/services", {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const list = (await listRes.json()) as Array<{ domain: string }>;
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.domain).sort()).toEqual(["svc-a.com", "svc-b.com"]);

    // Delete one
    await app.request("/registry/services/svc-a.com", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    // Verify only one remains
    const listRes2 = await app.request("/registry/services", {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const list2 = (await listRes2.json()) as Array<{ domain: string }>;
    expect(list2).toHaveLength(1);
    expect(list2[0].domain).toBe("svc-b.com");
  });

  it("should search services via registry", async () => {
    const app = createApp();

    // Register with specific description
    await app.request(
      "/registry/services?domain=weather.io",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: `---\nname: Weather API\ngateway: nkmc\nversion: "1.0"\nroles: [agent]\n---\n# Weather API\nWeather forecasts and climate data.`,
      },
    );

    await app.request(
      "/registry/services?domain=shop.io",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: `---\nname: Shop API\ngateway: nkmc\nversion: "1.0"\nroles: [agent]\n---\n# Shop API\nOnline shopping platform.`,
      },
    );

    // Search for weather
    const searchRes = await app.request("/registry/services?q=weather", {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(searchRes.status).toBe(200);
    const results = (await searchRes.json()) as Array<{ domain: string }>;
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("weather.io");
  });

  it("should reject agent requests with invalid JWT", async () => {
    const app = createApp();

    const res = await app.request("/execute", {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "ls /" }),
    });
    expect(res.status).toBe(401);
  });
});
