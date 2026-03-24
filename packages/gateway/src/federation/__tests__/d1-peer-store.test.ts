import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createSqliteD1 } from "../../d1/sqlite-adapter.js";
import { D1PeerStore } from "../d1-peer-store.js";
import type { D1Database as D1 } from "../../d1/types.js";
import type { PeerGateway, LendingRule } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../../migrations",
);

const MIGRATION_FILES = [
  "0001_init.sql",
  "0002_auth_mode.sql",
  "0003_federation.sql",
];

async function applyMigrations(db: D1): Promise<void> {
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8");
    await db.exec(sql);
  }
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("D1PeerStore — SQLite integration", () => {
  let raw: Database.Database;
  let db: D1;
  let store: D1PeerStore;

  beforeEach(async () => {
    raw = new Database(":memory:");
    db = createSqliteD1(raw);
    await applyMigrations(db);
    store = new D1PeerStore(db);
  });

  afterEach(() => {
    raw.close();
  });

  // -----------------------------------------------------------------------
  // Peer CRUD
  // -----------------------------------------------------------------------

  it("putPeer then getPeer returns the peer", async () => {
    const peer = makePeer();
    await store.putPeer(peer);

    const result = await store.getPeer("peer-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("peer-1");
    expect(result!.name).toBe("Test Gateway");
    expect(result!.url).toBe("https://peer1.example.com");
    expect(result!.sharedSecret).toBe("secret-abc");
    expect(result!.status).toBe("active");
    expect(result!.advertisedDomains).toEqual(["api.example.com"]);
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

  it("putPeer overwrites existing peer", async () => {
    await store.putPeer(makePeer({ name: "Original" }));
    await store.putPeer(makePeer({ name: "Updated" }));

    const peer = await store.getPeer("peer-1");
    expect(peer!.name).toBe("Updated");
  });

  // -----------------------------------------------------------------------
  // Lending Rule CRUD
  // -----------------------------------------------------------------------

  it("putRule then getRule returns the rule", async () => {
    const rule = makeRule();
    await store.putRule(rule);

    const result = await store.getRule("api.example.com");
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("api.example.com");
    expect(result!.allow).toBe(true);
    expect(result!.peers).toBe("*");
    expect(result!.pricing).toEqual({ mode: "free" });
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

  it("putRule overwrites existing rule", async () => {
    await store.putRule(makeRule({ domain: "x.com", allow: true }));
    await store.putRule(makeRule({ domain: "x.com", allow: false }));

    const rule = await store.getRule("x.com");
    expect(rule!.allow).toBe(false);
  });

  it("stores and retrieves rateLimit", async () => {
    const rule = makeRule({
      rateLimit: { requests: 100, window: "minute" },
    });
    await store.putRule(rule);

    const result = await store.getRule("api.example.com");
    expect(result!.rateLimit).toEqual({ requests: 100, window: "minute" });
  });

  it("stores rule with specific peer list", async () => {
    const rule = makeRule({
      peers: ["peer-1", "peer-2"],
      pricing: { mode: "per-request", amount: 0.01 },
    });
    await store.putRule(rule);

    const result = await store.getRule("api.example.com");
    expect(result!.peers).toEqual(["peer-1", "peer-2"]);
    expect(result!.pricing).toEqual({ mode: "per-request", amount: 0.01 });
  });

  // -----------------------------------------------------------------------
  // Migration completeness
  // -----------------------------------------------------------------------

  it("peers and lending_rules tables exist after migrations", async () => {
    for (const table of ["peers", "lending_rules"]) {
      const row = await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .bind(table)
        .first<{ name: string }>();
      expect(row, `table '${table}' should exist`).not.toBeNull();
    }
  });
});
