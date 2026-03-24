import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createGateway } from "../../src/http/app.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { generateGatewayKeyPair, createTestToken } from "@nkmc/core/testing";
import type { GatewayKeyPair } from "@nkmc/core";

const SKILL_MD = `---
name: "Acme Store"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme Store

E-commerce service for products.

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

### Create product

\`POST /api/products\` — 0.01 USDC / call, agent

Creates a new product.
`;

const ADMIN_TOKEN = "test-admin-secret";

describe("Gateway HTTP", () => {
  let keys: GatewayKeyPair;

  beforeAll(async () => {
    keys = await generateGatewayKeyPair();
  });

  function createApp() {
    const store = new MemoryRegistryStore();
    const app = createGateway({
      store,
      gatewayPrivateKey: keys.privateKey,
      gatewayPublicKey: keys.publicKey,
      adminToken: ADMIN_TOKEN,
    });
    return { app, store };
  }

  describe("Admin Auth", () => {
    it("should reject requests without auth", async () => {
      const { app } = createApp();
      const res = await app.request("/registry/services");
      expect(res.status).toBe(401);
    });

    it("should reject requests with wrong token", async () => {
      const { app } = createApp();
      const res = await app.request("/registry/services", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(403);
    });

    it("should accept requests with correct admin token", async () => {
      const { app } = createApp();
      const res = await app.request("/registry/services", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("Registry Routes", () => {
    it("should register a service via skill.md", async () => {
      const { app } = createApp();
      const res = await app.request(
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
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.domain).toBe("acme-store.com");
      expect(body.name).toBe("Acme Store");
    });

    it("should register a service via JSON body", async () => {
      const { app } = createApp();
      const res = await app.request(
        "/registry/services?domain=acme-store.com",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ADMIN_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ skillMd: SKILL_MD }),
        },
      );
      expect(res.status).toBe(201);
    });

    it("should list registered services", async () => {
      const { app } = createApp();
      // Register first
      await app.request("/registry/services?domain=acme-store.com", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: SKILL_MD,
      });

      const res = await app.request("/registry/services", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list).toHaveLength(1);
      expect(list[0].domain).toBe("acme-store.com");
    });

    it("should get service details", async () => {
      const { app } = createApp();
      await app.request("/registry/services?domain=acme-store.com", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: SKILL_MD,
      });

      const res = await app.request("/registry/services/acme-store.com", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(detail.domain).toBe("acme-store.com");
      expect(detail.skillMd).toBeTruthy();
    });

    it("should return 404 for unknown service", async () => {
      const { app } = createApp();
      const res = await app.request("/registry/services/unknown.com", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(404);
    });

    it("should delete a service", async () => {
      const { app } = createApp();
      await app.request("/registry/services?domain=acme-store.com", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: SKILL_MD,
      });

      const res = await app.request("/registry/services/acme-store.com", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify deleted
      const getRes = await app.request("/registry/services/acme-store.com", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(getRes.status).toBe(404);
    });

    it("should search services", async () => {
      const { app } = createApp();
      await app.request("/registry/services?domain=acme-store.com", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: SKILL_MD,
      });

      const res = await app.request("/registry/services?q=products", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const results = await res.json();
      expect(results.length).toBeGreaterThan(0);
    });

    it("should reject missing domain parameter", async () => {
      const { app } = createApp();
      const res = await app.request("/registry/services", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "text/markdown",
        },
        body: SKILL_MD,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Auth Token Route", () => {
    it("should issue a JWT token", async () => {
      const { app } = createApp();
      const res = await app.request("/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub: "agent-1",
          svc: "acme-store.com",
          roles: ["agent"],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTruthy();
      expect(typeof body.token).toBe("string");
    });

    it("should reject missing fields", async () => {
      const { app } = createApp();
      const res = await app.request("/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub: "agent-1" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Agent Auth", () => {
    it("should reject /execute without JWT", async () => {
      const { app } = createApp();
      const res = await app.request("/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls /" }),
      });
      expect(res.status).toBe(401);
    });

    it("should reject /fs/ without JWT", async () => {
      const { app } = createApp();
      const res = await app.request("/fs/");
      expect(res.status).toBe(401);
    });

    it("should accept /execute with valid JWT", async () => {
      const { app } = createApp();
      const token = await createTestToken(keys.privateKey, {
        sub: "agent-1",
        roles: ["agent"],
        svc: "gateway",
      });

      const res = await app.request("/execute", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: "ls /" }),
      });
      // Should succeed (200) even if empty - the request was authenticated
      expect(res.status).toBe(200);
    });
  });
});
