import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { MemoryPeerStore } from "../../../federation/peer-store.js";
import { adminAuth } from "../../middleware/admin-auth.js";
import { peerRoutes } from "../peers.js";

const ADMIN_TOKEN = "test-admin-token";

function createTestApp(peerStore?: MemoryPeerStore) {
  const store = peerStore ?? new MemoryPeerStore();
  const app = new Hono();
  app.use("/admin/federation/*", adminAuth(ADMIN_TOKEN));
  app.route("/admin/federation", peerRoutes({ peerStore: store }));
  return { app, peerStore: store };
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ADMIN_TOKEN}`,
  };
}

describe("peer admin routes", () => {
  describe("PUT /admin/federation/peers/:id", () => {
    it("creates a new peer", async () => {
      const { app, peerStore } = createTestApp();

      const res = await app.request("/admin/federation/peers/peer-1", {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({
          name: "Peer One",
          url: "https://peer1.example.com",
          sharedSecret: "secret-123",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, id: "peer-1" });

      const stored = await peerStore.getPeer("peer-1");
      expect(stored).not.toBeNull();
      expect(stored!.name).toBe("Peer One");
      expect(stored!.url).toBe("https://peer1.example.com");
      expect(stored!.sharedSecret).toBe("secret-123");
      expect(stored!.status).toBe("active");
    });

    it("updates an existing peer", async () => {
      const peerStore = new MemoryPeerStore();
      await peerStore.putPeer({
        id: "peer-1",
        name: "Old Name",
        url: "https://old.example.com",
        sharedSecret: "old-secret",
        status: "active",
        advertisedDomains: ["api.example.com"],
        lastSeen: 1000,
        createdAt: 500,
      });

      const { app } = createTestApp(peerStore);

      const res = await app.request("/admin/federation/peers/peer-1", {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({
          name: "New Name",
          url: "https://new.example.com",
          sharedSecret: "new-secret",
        }),
      });

      expect(res.status).toBe(200);

      const stored = await peerStore.getPeer("peer-1");
      expect(stored!.name).toBe("New Name");
      expect(stored!.url).toBe("https://new.example.com");
      // Preserves existing fields
      expect(stored!.advertisedDomains).toEqual(["api.example.com"]);
      expect(stored!.createdAt).toBe(500);
    });

    it("rejects when missing required fields", async () => {
      const { app } = createTestApp();

      const res = await app.request("/admin/federation/peers/peer-1", {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ name: "Missing url and secret" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Missing required fields");
    });

    it("rejects without admin auth", async () => {
      const { app } = createTestApp();

      const res = await app.request("/admin/federation/peers/peer-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Peer",
          url: "https://peer.example.com",
          sharedSecret: "secret",
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /admin/federation/peers", () => {
    it("lists peers without sharedSecret", async () => {
      const peerStore = new MemoryPeerStore();
      await peerStore.putPeer({
        id: "peer-1",
        name: "Peer One",
        url: "https://peer1.example.com",
        sharedSecret: "secret-should-not-appear",
        status: "active",
        advertisedDomains: [],
        lastSeen: 0,
        createdAt: Date.now(),
      });

      const { app } = createTestApp(peerStore);

      const res = await app.request("/admin/federation/peers", {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.peers).toHaveLength(1);
      expect(body.peers[0].id).toBe("peer-1");
      expect(body.peers[0].name).toBe("Peer One");
      expect(body.peers[0]).not.toHaveProperty("sharedSecret");
    });
  });

  describe("DELETE /admin/federation/peers/:id", () => {
    it("removes a peer", async () => {
      const peerStore = new MemoryPeerStore();
      await peerStore.putPeer({
        id: "peer-1",
        name: "Peer One",
        url: "https://peer1.example.com",
        sharedSecret: "secret",
        status: "active",
        advertisedDomains: [],
        lastSeen: 0,
        createdAt: Date.now(),
      });

      const { app } = createTestApp(peerStore);

      const res = await app.request("/admin/federation/peers/peer-1", {
        method: "DELETE",
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, id: "peer-1" });

      const stored = await peerStore.getPeer("peer-1");
      expect(stored).toBeNull();
    });
  });

  describe("PUT /admin/federation/rules/:domain", () => {
    it("creates a lending rule", async () => {
      const { app, peerStore } = createTestApp();

      const res = await app.request(
        "/admin/federation/rules/api.example.com",
        {
          method: "PUT",
          headers: adminHeaders(),
          body: JSON.stringify({
            allow: true,
            peers: ["peer-1", "peer-2"],
            pricing: { mode: "per-request", amount: 100 },
            rateLimit: { requests: 60, window: "minute" },
          }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, domain: "api.example.com" });

      const rule = await peerStore.getRule("api.example.com");
      expect(rule).not.toBeNull();
      expect(rule!.allow).toBe(true);
      expect(rule!.peers).toEqual(["peer-1", "peer-2"]);
      expect(rule!.pricing).toEqual({ mode: "per-request", amount: 100 });
      expect(rule!.rateLimit).toEqual({ requests: 60, window: "minute" });
    });

    it("rejects when missing allow field", async () => {
      const { app } = createTestApp();

      const res = await app.request(
        "/admin/federation/rules/api.example.com",
        {
          method: "PUT",
          headers: adminHeaders(),
          body: JSON.stringify({ peers: "*" }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("allow");
    });
  });

  describe("GET /admin/federation/rules", () => {
    it("lists all lending rules", async () => {
      const peerStore = new MemoryPeerStore();
      await peerStore.putRule({
        domain: "api.example.com",
        allow: true,
        peers: "*",
        pricing: { mode: "free" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await peerStore.putRule({
        domain: "github.com",
        allow: false,
        peers: ["peer-1"],
        pricing: { mode: "per-token", amount: 50 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const { app } = createTestApp(peerStore);

      const res = await app.request("/admin/federation/rules", {
        headers: adminHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toHaveLength(2);
      expect(body.rules.map((r: any) => r.domain).sort()).toEqual([
        "api.example.com",
        "github.com",
      ]);
    });
  });

  describe("DELETE /admin/federation/rules/:domain", () => {
    it("removes a lending rule", async () => {
      const peerStore = new MemoryPeerStore();
      await peerStore.putRule({
        domain: "api.example.com",
        allow: true,
        peers: "*",
        pricing: { mode: "free" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const { app } = createTestApp(peerStore);

      const res = await app.request(
        "/admin/federation/rules/api.example.com",
        {
          method: "DELETE",
          headers: adminHeaders(),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, domain: "api.example.com" });

      const rule = await peerStore.getRule("api.example.com");
      expect(rule).toBeNull();
    });
  });
});
