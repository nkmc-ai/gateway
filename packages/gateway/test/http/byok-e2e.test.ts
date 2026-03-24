import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createGateway } from "../../src/http/app.js";
import { D1RegistryStore } from "../../src/registry/d1-store.js";
import { D1CredentialVault } from "../../src/credential/d1-vault.js";
import { SqliteD1 } from "../../src/testing/sqlite-d1.js";
import { generateGatewayKeyPair, createTestToken } from "@nkmc/core/testing";
import type { GatewayKeyPair } from "@nkmc/core";

const ADMIN_TOKEN = "byok-e2e-admin";

const SKILL_MD = `---
name: "Secured API"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Secured API

An API that requires authentication.

## Schema

### data (read: agent)

Some data.

| field | type | description |
|-------|------|-------------|
| id | string | ID |

## API

### List data

\`GET /api/data\` — agent

Returns data.
`;

describe("BYOK E2E", () => {
  let keys: GatewayKeyPair;
  let encryptionKey: CryptoKey;

  beforeAll(async () => {
    keys = await generateGatewayKeyPair();
    encryptionKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  });

  let db: SqliteD1;
  let store: D1RegistryStore;
  let vault: D1CredentialVault;

  beforeEach(async () => {
    db = new SqliteD1();
    store = new D1RegistryStore(db);
    await store.initSchema();
    vault = new D1CredentialVault(db, encryptionKey);
    await vault.initSchema();
  });

  afterEach(() => {
    db.close();
  });

  function createApp() {
    return createGateway({
      store,
      vault,
      gatewayPrivateKey: keys.privateKey,
      gatewayPublicKey: keys.publicKey,
      adminToken: ADMIN_TOKEN,
    });
  }

  it("agent uploads BYOK → resolver uses BYOK credential over pool", async () => {
    const app = createApp();

    // 1. Register a service
    await app.request("/registry/services?domain=secured-api.com", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "text/markdown",
      },
      body: SKILL_MD,
    });

    // 2. Set a pool credential (shared fallback)
    await app.request("/credentials/secured-api.com", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth: { type: "bearer", token: "pool-token-shared" } }),
    });

    // 3. Agent obtains JWT
    const authRes = await app.request("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "agent-byok-1", svc: "gateway", roles: ["agent"] }),
    });
    const { token: agentJwt } = (await authRes.json()) as { token: string };

    // 4. Agent uploads BYOK credential
    const byokRes = await app.request("/byok/secured-api.com", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${agentJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth: { type: "bearer", token: "byok-agent-secret" } }),
    });
    expect(byokRes.status).toBe(200);

    // 5. Verify BYOK takes priority: vault.get(domain, agentId) → BYOK
    const cred = await vault.get("secured-api.com", "agent-byok-1");
    expect(cred).not.toBeNull();
    expect(cred!.scope).toBe("byok");
    expect(cred!.auth).toEqual({ type: "bearer", token: "byok-agent-secret" });

    // 6. Verify pool still available for other agents
    const poolCred = await vault.get("secured-api.com");
    expect(poolCred!.scope).toBe("pool");
    expect(poolCred!.auth).toEqual({ type: "bearer", token: "pool-token-shared" });
  });

  it("agent lists only their own BYOK domains", async () => {
    const app = createApp();

    // Two agents
    const auth1 = await app.request("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "agent-a", svc: "gateway", roles: ["agent"] }),
    });
    const jwt1 = ((await auth1.json()) as { token: string }).token;

    const auth2 = await app.request("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "agent-b", svc: "gateway", roles: ["agent"] }),
    });
    const jwt2 = ((await auth2.json()) as { token: string }).token;

    // Agent A uploads 2 BYOK keys
    for (const domain of ["api.openai.com", "api.github.com"]) {
      await app.request(`/byok/${domain}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${jwt1}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ auth: { type: "bearer", token: `key-a-${domain}` } }),
      });
    }

    // Agent B uploads 1 BYOK key
    await app.request("/byok/api.stripe.com", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${jwt2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth: { type: "bearer", token: "key-b-stripe" } }),
    });

    // Agent A lists → sees only their 2 domains
    const listA = await app.request("/byok", {
      headers: { Authorization: `Bearer ${jwt1}` },
    });
    const bodyA = (await listA.json()) as { domains: string[] };
    expect(bodyA.domains.sort()).toEqual(["api.github.com", "api.openai.com"]);

    // Agent B lists → sees only their 1 domain
    const listB = await app.request("/byok", {
      headers: { Authorization: `Bearer ${jwt2}` },
    });
    const bodyB = (await listB.json()) as { domains: string[] };
    expect(bodyB.domains).toEqual(["api.stripe.com"]);
  });

  it("agent deletes BYOK → falls back to pool", async () => {
    const app = createApp();

    // Pool credential
    await vault.putPool("api.example.com", { type: "bearer", token: "pool-tok" });

    // Agent JWT
    const authRes = await app.request("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "agent-del", svc: "gateway", roles: ["agent"] }),
    });
    const jwt = ((await authRes.json()) as { token: string }).token;

    // Upload BYOK
    await app.request("/byok/api.example.com", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth: { type: "bearer", token: "byok-tok" } }),
    });

    // BYOK takes priority
    let cred = await vault.get("api.example.com", "agent-del");
    expect(cred!.auth).toEqual({ type: "bearer", token: "byok-tok" });

    // Delete BYOK
    const delRes = await app.request("/byok/api.example.com", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(delRes.status).toBe(200);

    // Falls back to pool
    cred = await vault.get("api.example.com", "agent-del");
    expect(cred!.scope).toBe("pool");
    expect(cred!.auth).toEqual({ type: "bearer", token: "pool-tok" });
  });

  it("BYOK requires agent auth — rejects unauthenticated requests", async () => {
    const app = createApp();

    const res = await app.request("/byok/api.example.com", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: { type: "bearer", token: "x" } }),
    });
    expect(res.status).toBe(401);
  });
});
