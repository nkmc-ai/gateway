import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { MemoryTunnelStore } from "../memory-store.js";
import { tunnelRoutes } from "../../http/routes/tunnels.js";
import type { TunnelProvider, TunnelRecord } from "../types.js";

// ---------------------------------------------------------------------------
// Mock TunnelProvider
// ---------------------------------------------------------------------------

function createMockProvider(): TunnelProvider & {
  createFn: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
} {
  const createFn = vi.fn(async (_name: string, _hostname: string) => ({
    tunnelId: "cf-tunnel-abc",
    tunnelToken: "eyJhIjoiMTIzIn0.token",
  }));
  const deleteFn = vi.fn(async () => {});

  return {
    create: createFn,
    delete: deleteFn,
    createFn,
    deleteFn,
  };
}

// ---------------------------------------------------------------------------
// Test app helper — stubs agent auth
// ---------------------------------------------------------------------------

function createTestApp(agentId = "agent-1") {
  const store = new MemoryTunnelStore();
  const provider = createMockProvider();

  type Env = {
    Variables: {
      agent: { id: string; roles: string[] };
    };
  };

  const app = new Hono<Env>();

  // Stub agent auth
  app.use("*", async (c, next) => {
    c.set("agent", { id: agentId, roles: ["read"] });
    await next();
  });

  app.route(
    "/tunnels",
    tunnelRoutes({
      tunnelStore: store,
      tunnelProvider: provider,
      tunnelDomain: "tunnel.example.com",
    }),
  );

  return { app, store, provider };
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

/** Helper to build a complete TunnelRecord with sensible defaults */
function makeRecord(overrides: Partial<TunnelRecord> & { id: string; agentId: string }): TunnelRecord {
  return {
    tunnelId: `cf-${overrides.id}`,
    publicUrl: `https://${overrides.id}.tunnel.example.com`,
    status: "active",
    createdAt: Date.now(),
    advertisedDomains: [],
    lastSeen: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MemoryTunnelStore unit tests
// ---------------------------------------------------------------------------

describe("MemoryTunnelStore", () => {
  it("put and get by id", async () => {
    const store = new MemoryTunnelStore();
    const record: TunnelRecord = makeRecord({
      id: "t1",
      agentId: "agent-1",
      tunnelId: "cf-123",
    });

    await store.put(record);
    const result = await store.get("t1");
    expect(result).toEqual(record);
  });

  it("get returns null for missing id", async () => {
    const store = new MemoryTunnelStore();
    expect(await store.get("nonexistent")).toBeNull();
  });

  it("getByAgent returns active tunnel for agent", async () => {
    const store = new MemoryTunnelStore();
    await store.put(makeRecord({
      id: "t1",
      agentId: "agent-1",
      tunnelId: "cf-123",
    }));
    await store.put(makeRecord({
      id: "t2",
      agentId: "agent-2",
      tunnelId: "cf-456",
    }));

    const result = await store.getByAgent("agent-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("t1");
  });

  it("getByAgent skips deleted tunnels", async () => {
    const store = new MemoryTunnelStore();
    await store.put(makeRecord({
      id: "t1",
      agentId: "agent-1",
      tunnelId: "cf-123",
      status: "deleted",
    }));

    expect(await store.getByAgent("agent-1")).toBeNull();
  });

  it("delete removes record", async () => {
    const store = new MemoryTunnelStore();
    await store.put(makeRecord({
      id: "t1",
      agentId: "agent-1",
      tunnelId: "cf-123",
    }));

    await store.delete("t1");
    expect(await store.get("t1")).toBeNull();
  });

  it("list returns all records", async () => {
    const store = new MemoryTunnelStore();
    await store.put(makeRecord({
      id: "t1",
      agentId: "agent-1",
      tunnelId: "cf-1",
      createdAt: 1000,
    }));
    await store.put(makeRecord({
      id: "t2",
      agentId: "agent-2",
      tunnelId: "cf-2",
      createdAt: 2000,
    }));

    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });
});

// ---------------------------------------------------------------------------
// Tunnel route tests
// ---------------------------------------------------------------------------

describe("tunnel routes", () => {
  describe("POST /tunnels/create", () => {
    it("creates a tunnel and returns tunnelToken + publicUrl", async () => {
      const { app, provider } = createTestApp();

      const res = await app.request("/tunnels/create", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toHaveProperty("tunnelId");
      expect(body).toHaveProperty("tunnelToken", "eyJhIjoiMTIzIn0.token");
      expect(body.publicUrl).toMatch(/^https:\/\/.+\.tunnel\.example\.com$/);

      // Provider was called
      expect(provider.createFn).toHaveBeenCalledOnce();
      const [name, hostname] = provider.createFn.mock.calls[0];
      expect(name).toMatch(/^nkmc-agent-1-/);
      expect(hostname).toMatch(/\.tunnel\.example\.com$/);
    });

    it("returns existing tunnel if agent already has one", async () => {
      const { app, store } = createTestApp();

      // Pre-populate an active tunnel for agent-1
      await store.put(makeRecord({
        id: "existing-id",
        agentId: "agent-1",
        tunnelId: "cf-existing",
        publicUrl: "https://existing-id.tunnel.example.com",
      }));

      const res = await app.request("/tunnels/create", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tunnelId).toBe("existing-id");
      expect(body.publicUrl).toBe("https://existing-id.tunnel.example.com");
      expect(body.message).toBe("Tunnel already exists");
      // Should NOT have tunnelToken — we don't re-issue it
      expect(body).not.toHaveProperty("tunnelToken");
    });

    it("stores advertisedDomains and gatewayName from create request", async () => {
      const { app, store } = createTestApp();

      const res = await app.request("/tunnels/create", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          advertisedDomains: ["api.openai.com", "api.github.com"],
          gatewayName: "Alice's Gateway",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      // Verify the store has the advertised domains
      const record = await store.get(body.tunnelId);
      expect(record).not.toBeNull();
      expect(record!.advertisedDomains).toEqual(["api.openai.com", "api.github.com"]);
      expect(record!.gatewayName).toBe("Alice's Gateway");
    });
  });

  describe("DELETE /tunnels/:id", () => {
    it("deletes the agent's tunnel", async () => {
      const { app, store, provider } = createTestApp();

      await store.put(makeRecord({
        id: "t1",
        agentId: "agent-1",
        tunnelId: "cf-del",
      }));

      const res = await app.request("/tunnels/t1", {
        method: "DELETE",
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      // Provider delete was called with the CF tunnel ID
      expect(provider.deleteFn).toHaveBeenCalledWith("cf-del");

      // Store no longer has the record
      expect(await store.get("t1")).toBeNull();
    });

    it("returns 404 for nonexistent tunnel", async () => {
      const { app } = createTestApp();

      const res = await app.request("/tunnels/nonexistent", {
        method: "DELETE",
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Tunnel not found");
    });

    it("returns 403 when deleting another agent's tunnel", async () => {
      const { app, store } = createTestApp("agent-1");

      // Tunnel belongs to agent-2
      await store.put(makeRecord({
        id: "t-other",
        agentId: "agent-2",
        tunnelId: "cf-other",
      }));

      const res = await app.request("/tunnels/t-other", {
        method: "DELETE",
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Not your tunnel");
    });
  });

  describe("GET /tunnels", () => {
    it("lists only the authenticated agent's tunnels", async () => {
      const { app, store } = createTestApp("agent-1");

      await store.put(makeRecord({
        id: "t1",
        agentId: "agent-1",
        tunnelId: "cf-1",
        createdAt: 1000,
      }));
      await store.put(makeRecord({
        id: "t2",
        agentId: "agent-2",
        tunnelId: "cf-2",
        createdAt: 2000,
      }));
      await store.put(makeRecord({
        id: "t3",
        agentId: "agent-1",
        tunnelId: "cf-3",
        status: "deleted",
        createdAt: 3000,
      }));

      const res = await app.request("/tunnels", {
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // agent-1 has t1 (active) and t3 (deleted) — both returned, filtered by agentId
      expect(body.tunnels).toHaveLength(2);
      expect(body.tunnels.map((t: any) => t.id).sort()).toEqual(["t1", "t3"]);
    });
  });

  // -------------------------------------------------------------------------
  // Discovery tests
  // -------------------------------------------------------------------------

  describe("GET /tunnels/discover", () => {
    it("returns all active gateways", async () => {
      const { app, store } = createTestApp();

      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        advertisedDomains: ["api.openai.com"],
        gatewayName: "Alice",
      }));
      await store.put(makeRecord({
        id: "gw-2",
        agentId: "agent-2",
        advertisedDomains: ["api.github.com"],
        gatewayName: "Bob",
      }));
      // Deleted tunnel should not appear
      await store.put(makeRecord({
        id: "gw-3",
        agentId: "agent-3",
        status: "deleted",
        advertisedDomains: ["api.openai.com"],
      }));

      const res = await app.request("/tunnels/discover", {
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gateways).toHaveLength(2);
      expect(body.gateways.map((g: any) => g.id).sort()).toEqual(["gw-1", "gw-2"]);
    });

    it("filters by advertised domain", async () => {
      const { app, store } = createTestApp();

      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        advertisedDomains: ["api.openai.com", "api.anthropic.com"],
        gatewayName: "Alice",
      }));
      await store.put(makeRecord({
        id: "gw-2",
        agentId: "agent-2",
        advertisedDomains: ["api.github.com"],
        gatewayName: "Bob",
      }));

      const res = await app.request("/tunnels/discover?domain=api.openai.com", {
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gateways).toHaveLength(1);
      expect(body.gateways[0].id).toBe("gw-1");
      expect(body.gateways[0].advertisedDomains).toEqual(["api.openai.com", "api.anthropic.com"]);
    });

    it("returns empty array when no gateways match domain filter", async () => {
      const { app, store } = createTestApp();

      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        advertisedDomains: ["api.openai.com"],
      }));

      const res = await app.request("/tunnels/discover?domain=api.stripe.com", {
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gateways).toHaveLength(0);
    });

    it("does not expose tunnelToken or sensitive data", async () => {
      const { app, store } = createTestApp();

      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        tunnelId: "cf-secret-123",
        advertisedDomains: ["api.openai.com"],
        gatewayName: "Alice",
      }));

      const res = await app.request("/tunnels/discover", {
        headers: jsonHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gateways).toHaveLength(1);
      const gw = body.gateways[0];

      // Should have public fields
      expect(gw).toHaveProperty("id");
      expect(gw).toHaveProperty("name");
      expect(gw).toHaveProperty("publicUrl");
      expect(gw).toHaveProperty("advertisedDomains");

      // Should NOT have sensitive fields
      expect(gw).not.toHaveProperty("tunnelId");
      expect(gw).not.toHaveProperty("tunnelToken");
      expect(gw).not.toHaveProperty("agentId");
      expect(gw).not.toHaveProperty("lastSeen");
    });

    it("uses default name when gatewayName is not set", async () => {
      const { app, store } = createTestApp();

      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        advertisedDomains: [],
      }));

      const res = await app.request("/tunnels/discover", {
        headers: jsonHeaders(),
      });

      const body = await res.json();
      expect(body.gateways[0].name).toBe("gateway-gw-1");
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat tests
  // -------------------------------------------------------------------------

  describe("POST /tunnels/heartbeat", () => {
    it("updates advertised domains and lastSeen", async () => {
      const { app, store } = createTestApp("agent-1");

      const earlyTime = Date.now() - 60_000;
      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        advertisedDomains: ["api.openai.com"],
        lastSeen: earlyTime,
      }));

      const res = await app.request("/tunnels/heartbeat", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          advertisedDomains: ["api.openai.com", "api.github.com"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      // Verify store was updated
      const record = await store.get("gw-1");
      expect(record!.advertisedDomains).toEqual(["api.openai.com", "api.github.com"]);
      expect(record!.lastSeen).toBeGreaterThan(earlyTime);
    });

    it("preserves existing domains when none provided in heartbeat", async () => {
      const { app, store } = createTestApp("agent-1");

      await store.put(makeRecord({
        id: "gw-1",
        agentId: "agent-1",
        advertisedDomains: ["api.openai.com"],
      }));

      const res = await app.request("/tunnels/heartbeat", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);

      const record = await store.get("gw-1");
      expect(record!.advertisedDomains).toEqual(["api.openai.com"]);
    });

    it("returns 404 when agent has no active tunnel", async () => {
      const { app } = createTestApp("agent-1");

      const res = await app.request("/tunnels/heartbeat", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("No active tunnel");
    });
  });
});
