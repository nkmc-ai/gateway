import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { MemoryPeerStore } from "../../../federation/peer-store.js";
import { MemoryCredentialVault } from "../../../credential/memory-vault.js";
import { federationRoutes } from "../federation.js";
import type { PeerGateway, LendingRule } from "../../../federation/types.js";
import type { AgentFs } from "@nkmc/agent-fs";

function makePeer(overrides: Partial<PeerGateway> = {}): PeerGateway {
  return {
    id: "peer-1",
    name: "Test Peer",
    url: "https://peer1.example.com",
    sharedSecret: "secret-abc",
    status: "active",
    advertisedDomains: [],
    lastSeen: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<LendingRule> = {}): LendingRule {
  return {
    domain: "api.example.com",
    allow: true,
    peers: "*",
    pricing: { mode: "free" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockAgentFs() {
  return {
    execute: vi.fn(async () => ({
      ok: true as const,
      data: ["file1.txt", "file2.txt"],
    })),
    executeCommand: vi.fn(async () => ({
      ok: true as const,
      data: ["file1.txt"],
    })),
  } as unknown as AgentFs;
}

function createTestApp(options?: {
  peerStore?: MemoryPeerStore;
  vault?: MemoryCredentialVault;
  agentFs?: AgentFs;
}) {
  const peerStore = options?.peerStore ?? new MemoryPeerStore();
  const vault = options?.vault ?? new MemoryCredentialVault();
  const agentFs = options?.agentFs ?? createMockAgentFs();

  const app = new Hono();
  app.route("/federation", federationRoutes({ peerStore, vault, agentFs }));

  return { app, peerStore, vault, agentFs };
}

function peerHeaders(peer: PeerGateway) {
  return {
    "Content-Type": "application/json",
    "X-Peer-Id": peer.id,
    Authorization: `Bearer ${peer.sharedSecret}`,
  };
}

describe("federation routes", () => {
  describe("POST /federation/query", () => {
    it("returns available when credential and rule exist", async () => {
      const peerStore = new MemoryPeerStore();
      const vault = new MemoryCredentialVault();
      const peer = makePeer();

      await peerStore.putPeer(peer);
      await peerStore.putRule(makeRule({ domain: "api.example.com" }));
      await vault.putPool("api.example.com", {
        type: "bearer",
        token: "test-token",
      });

      const { app } = createTestApp({ peerStore, vault });

      const res = await app.request("/federation/query", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({ domain: "api.example.com" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(true);
      expect(body.pricing).toEqual({ mode: "free" });
    });

    it("returns unavailable when rule disallows", async () => {
      const peerStore = new MemoryPeerStore();
      const vault = new MemoryCredentialVault();
      const peer = makePeer();

      await peerStore.putPeer(peer);
      await peerStore.putRule(
        makeRule({ domain: "api.example.com", allow: false }),
      );
      await vault.putPool("api.example.com", {
        type: "bearer",
        token: "test-token",
      });

      const { app } = createTestApp({ peerStore, vault });

      const res = await app.request("/federation/query", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({ domain: "api.example.com" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(false);
    });

    it("returns unavailable when no credential exists", async () => {
      const peerStore = new MemoryPeerStore();
      const vault = new MemoryCredentialVault();
      const peer = makePeer();

      await peerStore.putPeer(peer);
      await peerStore.putRule(makeRule({ domain: "api.example.com" }));
      // No credential in vault

      const { app } = createTestApp({ peerStore, vault });

      const res = await app.request("/federation/query", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({ domain: "api.example.com" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(false);
    });

    it("returns unavailable when peer is not in allowed list", async () => {
      const peerStore = new MemoryPeerStore();
      const vault = new MemoryCredentialVault();
      const peer = makePeer({ id: "peer-1" });

      await peerStore.putPeer(peer);
      await peerStore.putRule(
        makeRule({
          domain: "api.example.com",
          peers: ["peer-other"], // peer-1 not in list
        }),
      );
      await vault.putPool("api.example.com", {
        type: "bearer",
        token: "test-token",
      });

      const { app } = createTestApp({ peerStore, vault });

      const res = await app.request("/federation/query", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({ domain: "api.example.com" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(false);
    });

    it("rejects unknown peer with 403", async () => {
      const { app } = createTestApp();

      const res = await app.request("/federation/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": "unknown-peer",
          Authorization: "Bearer wrong-secret",
        },
        body: JSON.stringify({ domain: "api.example.com" }),
      });

      expect(res.status).toBe(403);
    });

    it("rejects peer with wrong secret", async () => {
      const peerStore = new MemoryPeerStore();
      const peer = makePeer();
      await peerStore.putPeer(peer);

      const { app } = createTestApp({ peerStore });

      const res = await app.request("/federation/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": peer.id,
          Authorization: "Bearer wrong-secret",
        },
        body: JSON.stringify({ domain: "api.example.com" }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /federation/exec", () => {
    it("executes command with proper peer auth", async () => {
      const peerStore = new MemoryPeerStore();
      const vault = new MemoryCredentialVault();
      const peer = makePeer();
      const agentFs = createMockAgentFs();

      await peerStore.putPeer(peer);
      await peerStore.putRule(makeRule({ domain: "api.example.com" }));

      const { app } = createTestApp({ peerStore, vault, agentFs });

      const res = await app.request("/federation/exec", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({
          command: "ls /api.example.com/",
          agentId: "agent-1",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data).toEqual(["file1.txt", "file2.txt"]);

      // Verify synthetic agent context
      expect(agentFs.execute).toHaveBeenCalledWith(
        "ls /api.example.com/",
        ["agent"],
        { id: "peer:peer-1:agent-1", roles: ["agent"] },
      );
    });

    it("returns 402 when pricing is non-free and no payment header", async () => {
      const peerStore = new MemoryPeerStore();
      const peer = makePeer();

      await peerStore.putPeer(peer);
      await peerStore.putRule(
        makeRule({
          domain: "api.example.com",
          pricing: { mode: "per-request", amount: 100 },
        }),
      );

      const { app } = createTestApp({ peerStore });

      const res = await app.request("/federation/exec", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({
          command: "cat /api.example.com/data",
          agentId: "agent-1",
        }),
      });

      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toContain("Payment required");
    });

    it("returns 403 when domain is not allowed for lending", async () => {
      const peerStore = new MemoryPeerStore();
      const peer = makePeer();

      await peerStore.putPeer(peer);
      await peerStore.putRule(
        makeRule({ domain: "api.example.com", allow: false }),
      );

      const { app } = createTestApp({ peerStore });

      const res = await app.request("/federation/exec", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({
          command: "ls /api.example.com/",
          agentId: "agent-1",
        }),
      });

      expect(res.status).toBe(403);
    });

    it("returns 403 for unauthorized peer", async () => {
      const { app } = createTestApp();

      const res = await app.request("/federation/exec", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": "unknown",
          Authorization: "Bearer wrong",
        },
        body: JSON.stringify({
          command: "ls /api.example.com/",
          agentId: "agent-1",
        }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /federation/announce", () => {
    it("updates peer advertised domains", async () => {
      const peerStore = new MemoryPeerStore();
      const peer = makePeer({ advertisedDomains: [] });
      await peerStore.putPeer(peer);

      const { app } = createTestApp({ peerStore });

      const res = await app.request("/federation/announce", {
        method: "POST",
        headers: peerHeaders(peer),
        body: JSON.stringify({
          domains: ["api.example.com", "github.com"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify domains were updated in the store
      const updated = await peerStore.getPeer(peer.id);
      expect(updated!.advertisedDomains).toEqual([
        "api.example.com",
        "github.com",
      ]);
    });

    it("rejects unauthorized peer", async () => {
      const { app } = createTestApp();

      const res = await app.request("/federation/announce", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": "unknown",
          Authorization: "Bearer wrong",
        },
        body: JSON.stringify({ domains: ["api.example.com"] }),
      });

      expect(res.status).toBe(403);
    });
  });
});
