/**
 * Integration tests: prove that ALL existing D1-backed stores work unchanged
 * on the new createSqliteD1 adapter with real migration SQL applied.
 *
 * Unlike the per-store unit tests (which use SqliteD1 from testing/ and call
 * initSchema()), these tests apply the actual worker migration files to an
 * in-memory SQLite database wrapped by createSqliteD1.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createSqliteD1 } from "../d1/sqlite-adapter.js";
import { D1RegistryStore } from "../registry/d1-store.js";
import { D1CredentialVault } from "../credential/d1-vault.js";
import { D1MeterStore } from "../metering/d1-store.js";
import type { D1Database as D1 } from "../d1/types.js";
import type { ServiceRecord } from "../registry/types.js";
import type { MeterRecord } from "../metering/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../migrations",
);

const MIGRATION_FILES = [
  "0001_init.sql",
  "0002_auth_mode.sql",
  "0003_federation.sql",
];

/** Read and concatenate all migration SQL, split into individual statements. */
function readMigrations(): string[] {
  return MIGRATION_FILES.map((f) =>
    readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"),
  );
}

/** Apply all migrations via the D1 exec interface. */
async function applyMigrations(db: D1): Promise<void> {
  for (const sql of readMigrations()) {
    await db.exec(sql);
  }
}

function makeServiceRecord(
  domain: string,
  overrides?: Partial<ServiceRecord>,
): ServiceRecord {
  return {
    domain,
    name: overrides?.name ?? domain,
    description: overrides?.description ?? `Service ${domain}`,
    version: overrides?.version ?? "1.0",
    roles: ["agent"],
    skillMd: "---\nname: test\n---\n# Test",
    endpoints: [
      { method: "GET", path: "/api/test", description: "test endpoint" },
    ],
    isFirstParty: overrides?.isFirstParty ?? false,
    createdAt: overrides?.createdAt ?? Date.now(),
    updatedAt: overrides?.updatedAt ?? Date.now(),
    status: overrides?.status ?? "active",
    isDefault: overrides?.isDefault ?? true,
  };
}

function makeMeterEntry(overrides?: Partial<MeterRecord>): MeterRecord {
  return {
    id: overrides?.id ?? `m_${Math.random().toString(36).slice(2)}`,
    timestamp: overrides?.timestamp ?? Date.now(),
    domain: overrides?.domain ?? "api.example.com",
    version: overrides?.version ?? "1.0",
    endpoint: overrides?.endpoint ?? "GET /api/data",
    agentId: overrides?.agentId ?? "agent-1",
    developerId: overrides?.developerId,
    cost: overrides?.cost ?? 0.05,
    currency: overrides?.currency ?? "USDC",
  };
}

async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SQLite adapter integration — D1 stores over createSqliteD1", () => {
  let raw: Database.Database;
  let db: D1;

  beforeEach(async () => {
    raw = new Database(":memory:");
    db = createSqliteD1(raw);
    await applyMigrations(db);
  });

  afterEach(() => {
    raw.close();
  });

  // -----------------------------------------------------------------------
  // D1RegistryStore
  // -----------------------------------------------------------------------
  describe("D1RegistryStore", () => {
    let store: D1RegistryStore;

    beforeEach(() => {
      store = new D1RegistryStore(db);
    });

    it("put and get a service record", async () => {
      const record = makeServiceRecord("acme-api.com");
      await store.put("acme-api.com", record);

      const result = await store.get("acme-api.com");
      expect(result).not.toBeNull();
      expect(result!.domain).toBe("acme-api.com");
      expect(result!.name).toBe("acme-api.com");
      expect(result!.endpoints).toEqual(record.endpoints);
      expect(result!.roles).toEqual(["agent"]);
    });

    it("returns null for unknown domain", async () => {
      expect(await store.get("nonexistent.com")).toBeNull();
    });

    it("list returns all default services", async () => {
      await store.put("a.com", makeServiceRecord("a.com"));
      await store.put("b.com", makeServiceRecord("b.com", { isFirstParty: true }));
      // Non-default version should not appear
      await store.put(
        "a.com",
        makeServiceRecord("a.com", { version: "2.0", isDefault: false }),
      );

      const list = await store.list();
      expect(list).toHaveLength(2);
      const domains = list.map((s) => s.domain);
      expect(domains).toContain("a.com");
      expect(domains).toContain("b.com");
    });

    it("search by description and endpoint", async () => {
      await store.put(
        "weather.io",
        makeServiceRecord("weather.io", { description: "Weather forecasts" }),
      );
      await store.put(
        "store.io",
        makeServiceRecord("store.io", { description: "E-commerce" }),
      );

      const results = await store.search("weather");
      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe("weather.io");
    });

    it("stores and retrieves authMode from migration 0002", async () => {
      const record = makeServiceRecord("jwt-api.com");
      (record as ServiceRecord & { authMode: string }).authMode = "nkmc-jwt";
      await store.put("jwt-api.com", record);

      const result = await store.get("jwt-api.com");
      expect(result!.authMode).toBe("nkmc-jwt");
    });

    it("stats returns correct counts", async () => {
      await store.put("x.com", makeServiceRecord("x.com"));
      await store.put("y.com", makeServiceRecord("y.com"));

      const stats = await store.stats();
      expect(stats.serviceCount).toBe(2);
      expect(stats.endpointCount).toBe(2); // 1 endpoint each
    });
  });

  // -----------------------------------------------------------------------
  // D1CredentialVault
  // -----------------------------------------------------------------------
  describe("D1CredentialVault", () => {
    let vault: D1CredentialVault;

    beforeEach(async () => {
      const key = await generateEncryptionKey();
      vault = new D1CredentialVault(db, key);
    });

    it("put and get a pool credential with real AES-GCM encryption", async () => {
      await vault.putPool("api.stripe.com", {
        type: "bearer",
        token: "sk_test_abc123",
      });

      const cred = await vault.get("api.stripe.com");
      expect(cred).not.toBeNull();
      expect(cred!.scope).toBe("pool");
      expect(cred!.auth).toEqual({
        type: "bearer",
        token: "sk_test_abc123",
      });
    });

    it("returns null for unknown domain", async () => {
      expect(await vault.get("unknown.com")).toBeNull();
    });

    it("BYOK takes priority over pool", async () => {
      await vault.putPool("api.stripe.com", {
        type: "bearer",
        token: "pool_token",
      });
      await vault.putByok("api.stripe.com", "dev-42", {
        type: "api-key",
        header: "X-API-Key",
        key: "byok_secret",
      });

      // With developerId → BYOK wins
      const cred = await vault.get("api.stripe.com", "dev-42");
      expect(cred!.scope).toBe("byok");
      expect(cred!.auth).toEqual({
        type: "api-key",
        header: "X-API-Key",
        key: "byok_secret",
      });
    });

    it("falls back to pool when no BYOK for the developer", async () => {
      await vault.putPool("api.stripe.com", {
        type: "bearer",
        token: "pool_token",
      });

      const cred = await vault.get("api.stripe.com", "dev-99");
      expect(cred!.scope).toBe("pool");
      expect(cred!.auth).toEqual({
        type: "bearer",
        token: "pool_token",
      });
    });

    it("supports api-key auth type", async () => {
      await vault.putPool("openai.com", {
        type: "api-key",
        header: "Authorization",
        key: "sk-proj-xxx",
      });

      const cred = await vault.get("openai.com");
      expect(cred!.auth).toEqual({
        type: "api-key",
        header: "Authorization",
        key: "sk-proj-xxx",
      });
    });

    it("listDomains returns all stored domains", async () => {
      await vault.putPool("a.com", { type: "bearer", token: "t1" });
      await vault.putPool("b.com", { type: "bearer", token: "t2" });

      const domains = await vault.listDomains();
      expect(domains).toContain("a.com");
      expect(domains).toContain("b.com");
    });
  });

  // -----------------------------------------------------------------------
  // D1MeterStore
  // -----------------------------------------------------------------------
  describe("D1MeterStore", () => {
    let store: D1MeterStore;

    beforeEach(() => {
      store = new D1MeterStore(db);
    });

    it("record and query a meter entry", async () => {
      const entry = makeMeterEntry({ id: "meter-1" });
      await store.record(entry);

      const results = await store.query({ domain: entry.domain });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("meter-1");
      expect(results[0].agentId).toBe("agent-1");
      expect(results[0].cost).toBe(0.05);
    });

    it("sum by agentId", async () => {
      await store.record(
        makeMeterEntry({ id: "m1", agentId: "agent-A", cost: 0.10 }),
      );
      await store.record(
        makeMeterEntry({ id: "m2", agentId: "agent-A", cost: 0.25 }),
      );
      await store.record(
        makeMeterEntry({ id: "m3", agentId: "agent-B", cost: 1.00 }),
      );

      const { total, currency } = await store.sum({ agentId: "agent-A" });
      expect(total).toBeCloseTo(0.35);
      expect(currency).toBe("USDC");
    });

    it("returns zero for no matches", async () => {
      const { total } = await store.sum({ domain: "nonexistent.com" });
      expect(total).toBe(0);
    });

    it("filters by time range", async () => {
      await store.record(makeMeterEntry({ id: "m1", timestamp: 1000 }));
      await store.record(makeMeterEntry({ id: "m2", timestamp: 2000 }));
      await store.record(makeMeterEntry({ id: "m3", timestamp: 3000 }));

      const results = await store.query({ from: 1500, to: 2500 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m2");
    });

    it("records with developerId", async () => {
      await store.record(
        makeMeterEntry({ id: "m1", developerId: "dev-42" }),
      );

      const results = await store.query({ developerId: "dev-42" });
      expect(results).toHaveLength(1);
      expect(results[0].developerId).toBe("dev-42");
    });
  });

  // -----------------------------------------------------------------------
  // Cross-cutting: migrations create all expected tables
  // -----------------------------------------------------------------------
  describe("Migration completeness", () => {
    it("all expected tables exist after migrations", async () => {
      const tables = [
        "services",
        "credentials",
        "meter_records",
        "developer_agents",
        "claim_tokens",
        "domain_challenges",
        "peers",
        "lending_rules",
      ];

      for (const table of tables) {
        const row = await db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .bind(table)
          .first<{ name: string }>();
        expect(row, `table '${table}' should exist`).not.toBeNull();
      }
    });

    it("auth_mode column exists on services (migration 0002)", async () => {
      // Insert a row with auth_mode set — would fail if column missing
      await db
        .prepare(
          `INSERT INTO services (domain, version, name, skill_md, roles, endpoints, created_at, updated_at, auth_mode)
           VALUES ('test.com', '1.0', 'test', 'md', '[]', '[]', 0, 0, 'nkmc-jwt')`,
        )
        .run();

      const row = await db
        .prepare("SELECT auth_mode FROM services WHERE domain = ?")
        .bind("test.com")
        .first<{ auth_mode: string }>();
      expect(row!.auth_mode).toBe("nkmc-jwt");
    });
  });
});
