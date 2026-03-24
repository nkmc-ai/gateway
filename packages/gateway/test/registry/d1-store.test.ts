import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { D1RegistryStore } from "../../src/registry/d1-store.js";
import { SqliteD1 } from "../../src/testing/sqlite-d1.js";
import type { ServiceRecord } from "../../src/registry/types.js";

function makeRecord(
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

describe("D1RegistryStore", () => {
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

  it("should put and get a service", async () => {
    const record = makeRecord("acme-store.com");
    await store.put("acme-store.com", record);
    const result = await store.get("acme-store.com");
    expect(result).toEqual(record);
  });

  it("should return null for unknown domain", async () => {
    const result = await store.get("unknown.com");
    expect(result).toBeNull();
  });

  it("should delete a service", async () => {
    await store.put("acme.com", makeRecord("acme.com"));
    await store.delete("acme.com");
    expect(await store.get("acme.com")).toBeNull();
  });

  it("should list all services as summaries", async () => {
    await store.put("acme.com", makeRecord("acme.com"));
    await store.put("memory", makeRecord("memory", { isFirstParty: true }));
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      domain: "acme.com",
      name: "acme.com",
      description: "Service acme.com",
      isFirstParty: false,
    });
  });

  it("should search by description", async () => {
    await store.put(
      "weather.com",
      makeRecord("weather.com", { description: "Weather forecasts" }),
    );
    await store.put(
      "acme.com",
      makeRecord("acme.com", { description: "E-commerce store" }),
    );
    const results = await store.search("weather");
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("weather.com");
  });

  it("should search by endpoint description", async () => {
    const record = makeRecord("stripe.com", { description: "Payments" });
    record.endpoints = [
      { method: "POST", path: "/charges", description: "Create a charge" },
    ];
    await store.put("stripe.com", record);
    const results = await store.search("charge");
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("stripe.com");
  });

  it("should return empty for no search match", async () => {
    await store.put("acme.com", makeRecord("acme.com"));
    const results = await store.search("zzzzz");
    expect(results).toHaveLength(0);
  });

  it("should overwrite on duplicate put", async () => {
    await store.put("acme.com", makeRecord("acme.com", { description: "v1" }));
    await store.put("acme.com", makeRecord("acme.com", { description: "v2" }));
    const result = await store.get("acme.com");
    expect(result?.description).toBe("v2");
  });

  it("should call initSchema multiple times (idempotent)", async () => {
    await store.initSchema();
    await store.initSchema();
    await store.put("test.com", makeRecord("test.com"));
    expect(await store.get("test.com")).not.toBeNull();
  });

  it("should search by name", async () => {
    await store.put(
      "acme.com",
      makeRecord("acme.com", { name: "Acme Store" }),
    );
    const results = await store.search("Acme");
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("acme.com");
  });

  it("get() should return only isDefault=true records", async () => {
    await store.put("acme.com", makeRecord("acme.com", { version: "1.0", isDefault: false }));
    await store.put("acme.com", makeRecord("acme.com", { version: "2.0", isDefault: true }));
    const result = await store.get("acme.com");
    expect(result?.version).toBe("2.0");
  });

  it("list() should only return default versions", async () => {
    await store.put("acme.com", makeRecord("acme.com", { version: "1.0", isDefault: false }));
    await store.put("acme.com", makeRecord("acme.com", { version: "2.0", isDefault: true }));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].domain).toBe("acme.com");
  });

  it("getVersion() should return specific version", async () => {
    await store.put("acme.com", makeRecord("acme.com", { version: "1.0", isDefault: false }));
    await store.put("acme.com", makeRecord("acme.com", { version: "2.0", isDefault: true }));
    const v1 = await store.getVersion("acme.com", "1.0");
    expect(v1?.version).toBe("1.0");
    expect(v1?.isDefault).toBe(false);
  });

  it("listVersions() should return all versions for a domain", async () => {
    await store.put("acme.com", makeRecord("acme.com", { version: "1.0", createdAt: 1000 }));
    await store.put("acme.com", makeRecord("acme.com", { version: "2.0", createdAt: 2000 }));
    const versions = await store.listVersions("acme.com");
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe("2.0"); // most recent first
    expect(versions[1].version).toBe("1.0");
  });

  it("delete() should remove all versions", async () => {
    await store.put("acme.com", makeRecord("acme.com", { version: "1.0" }));
    await store.put("acme.com", makeRecord("acme.com", { version: "2.0" }));
    await store.delete("acme.com");
    expect(await store.get("acme.com")).toBeNull();
    expect(await store.getVersion("acme.com", "1.0")).toBeNull();
    expect(await store.listVersions("acme.com")).toEqual([]);
  });

  it("should store and retrieve source config", async () => {
    const record = makeRecord("acme.com");
    record.source = { type: "openapi", url: "https://acme.com/spec.json", refreshInterval: 3600 };
    await store.put("acme.com", record);
    const result = await store.get("acme.com");
    expect(result?.source).toEqual(record.source);
  });

  it("should store and retrieve sunsetDate", async () => {
    const record = makeRecord("acme.com");
    record.sunsetDate = Date.now() + 86400000;
    await store.put("acme.com", record);
    const result = await store.get("acme.com");
    expect(result?.sunsetDate).toBe(record.sunsetDate);
  });
});
