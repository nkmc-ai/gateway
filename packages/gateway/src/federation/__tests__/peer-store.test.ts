import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPeerStore } from "../peer-store.js";
import type { PeerGateway, LendingRule } from "../types.js";

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

describe("MemoryPeerStore", () => {
  let store: MemoryPeerStore;

  beforeEach(() => {
    store = new MemoryPeerStore();
  });

  // --- Peer CRUD ---

  it("putPeer then getPeer returns the peer", async () => {
    const peer = makePeer();
    await store.putPeer(peer);
    expect(await store.getPeer("peer-1")).toEqual(peer);
  });

  it("getPeer returns null for unknown id", async () => {
    expect(await store.getPeer("nonexistent")).toBeNull();
  });

  it("deletePeer removes the peer", async () => {
    await store.putPeer(makePeer());
    await store.deletePeer("peer-1");
    expect(await store.getPeer("peer-1")).toBeNull();
  });

  it("listPeers only returns active peers", async () => {
    await store.putPeer(makePeer({ id: "a", status: "active", name: "A" }));
    await store.putPeer(makePeer({ id: "b", status: "inactive", name: "B" }));
    await store.putPeer(makePeer({ id: "c", status: "active", name: "C" }));

    const list = await store.listPeers();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(["a", "c"]);
  });

  it("updateLastSeen updates the timestamp", async () => {
    await store.putPeer(makePeer({ lastSeen: 1000 }));
    await store.updateLastSeen("peer-1", 9999);

    const peer = await store.getPeer("peer-1");
    expect(peer!.lastSeen).toBe(9999);
  });

  it("updateLastSeen is a no-op for unknown peer", async () => {
    // should not throw
    await store.updateLastSeen("nonexistent", Date.now());
  });

  // --- Lending Rule CRUD ---

  it("putRule then getRule returns the rule", async () => {
    const rule = makeRule();
    await store.putRule(rule);
    expect(await store.getRule("api.example.com")).toEqual(rule);
  });

  it("getRule returns null for unknown domain", async () => {
    expect(await store.getRule("unknown.example.com")).toBeNull();
  });

  it("deleteRule removes the rule", async () => {
    await store.putRule(makeRule());
    await store.deleteRule("api.example.com");
    expect(await store.getRule("api.example.com")).toBeNull();
  });

  it("listRules returns all rules", async () => {
    await store.putRule(makeRule({ domain: "a.com" }));
    await store.putRule(makeRule({ domain: "b.com" }));
    await store.putRule(makeRule({ domain: "c.com" }));

    const list = await store.listRules();
    expect(list).toHaveLength(3);
    expect(list.map((r) => r.domain).sort()).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("putRule overwrites existing rule for same domain", async () => {
    await store.putRule(makeRule({ domain: "x.com", allow: true }));
    await store.putRule(makeRule({ domain: "x.com", allow: false }));

    const rule = await store.getRule("x.com");
    expect(rule!.allow).toBe(false);
  });
});
