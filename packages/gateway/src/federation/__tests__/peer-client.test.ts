import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PeerClient } from "../peer-client.js";
import type { PeerGateway } from "../types.js";

function makePeer(overrides: Partial<PeerGateway> = {}): PeerGateway {
  return {
    id: "peer-1",
    name: "Test Gateway",
    url: "https://peer1.example.com",
    sharedSecret: "secret-abc",
    status: "active",
    advertisedDomains: ["api.example.com"],
    lastSeen: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("PeerClient", () => {
  let client: PeerClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new PeerClient("self-gateway");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("query", () => {
    it("returns available:true when peer responds with it", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          available: true,
          pricing: { mode: "free" },
        }),
      });

      const result = await client.query(makePeer(), "api.example.com");

      expect(result).toEqual({
        available: true,
        pricing: { mode: "free" },
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://peer1.example.com/federation/query",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Peer-Id": "self-gateway",
            Authorization: "Bearer secret-abc",
          }),
        }),
      );
    });

    it("returns available:false on HTTP error", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await client.query(makePeer(), "api.example.com");
      expect(result).toEqual({ available: false });
    });

    it("returns available:false on network error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));

      const result = await client.query(makePeer(), "api.example.com");
      expect(result).toEqual({ available: false });
    });
  });

  describe("exec", () => {
    it("returns data on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: ["file1.txt", "file2.txt"] }),
      });

      const result = await client.exec(makePeer(), {
        command: "ls /api.example.com/",
        agentId: "agent-1",
      });

      expect(result).toEqual({
        ok: true,
        data: ["file1.txt", "file2.txt"],
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://peer1.example.com/federation/exec",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            command: "ls /api.example.com/",
            agentId: "agent-1",
          }),
        }),
      );
    });

    it("returns paymentRequired on 402", async () => {
      const headers = new Map([
        ["X-402-Price", "100"],
        ["X-402-Currency", "USD"],
        ["X-402-Pay-To", "wallet-abc"],
        ["X-402-Network", "lightning"],
      ]);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        headers: {
          get: (key: string) => headers.get(key) ?? null,
        },
      });

      const result = await client.exec(makePeer(), {
        command: "cat /api.example.com/data",
        agentId: "agent-1",
      });

      expect(result).toEqual({
        ok: false,
        paymentRequired: {
          price: 100,
          currency: "USD",
          payTo: "wallet-abc",
          network: "lightning",
        },
      });
    });

    it("returns error on non-402 failure", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      const result = await client.exec(makePeer(), {
        command: "ls /api.example.com/",
        agentId: "agent-1",
      });

      expect(result).toEqual({
        ok: false,
        error: "Internal server error",
      });
    });

    it("returns error on network failure", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("Connection refused"));

      const result = await client.exec(makePeer(), {
        command: "ls /api.example.com/",
        agentId: "agent-1",
      });

      expect(result).toEqual({
        ok: false,
        error: "Connection refused",
      });
    });
  });

  describe("announce", () => {
    it("sends domains to peer", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await client.announce(makePeer(), [
        "api.example.com",
        "github.com",
      ]);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://peer1.example.com/federation/announce",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Peer-Id": "self-gateway",
            Authorization: "Bearer secret-abc",
          }),
          body: JSON.stringify({
            domains: ["api.example.com", "github.com"],
          }),
        }),
      );
    });
  });
});
