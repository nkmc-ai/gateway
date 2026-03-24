// packages/gateway/test/registry/memory-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import type { ServiceRecord } from "../../src/registry/types.js";

function makeRecord(domain: string, overrides?: Partial<ServiceRecord>): ServiceRecord {
  return {
    domain,
    name: overrides?.name ?? domain,
    description: overrides?.description ?? `Service ${domain}`,
    version: overrides?.version ?? "1.0",
    roles: ["agent"],
    skillMd: "---\nname: test\n---\n# Test",
    endpoints: [{ method: "GET", path: "/api/test", description: "test endpoint" }],
    isFirstParty: overrides?.isFirstParty ?? false,
    createdAt: overrides?.createdAt ?? Date.now(),
    updatedAt: overrides?.updatedAt ?? Date.now(),
    status: overrides?.status ?? "active",
    isDefault: overrides?.isDefault ?? true,
  };
}

describe("MemoryRegistryStore", () => {
  let store: MemoryRegistryStore;

  beforeEach(() => {
    store = new MemoryRegistryStore();
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

  it("should search by description with empty matchedEndpoints", async () => {
    await store.put("weather.com", makeRecord("weather.com", { description: "Weather forecasts" }));
    await store.put("acme.com", makeRecord("acme.com", { description: "E-commerce store" }));
    const results = await store.search("weather");
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("weather.com");
    // "weather" matches the service description, not any endpoint
    expect(results[0].matchedEndpoints).toEqual([]);
  });

  it("should search by endpoint description and return matchedEndpoints", async () => {
    const record = makeRecord("stripe.com", { description: "Payments" });
    record.endpoints = [
      { method: "POST", path: "/charges", description: "Create a charge" },
      { method: "GET", path: "/charges/{id}", description: "Retrieve a charge" },
      { method: "GET", path: "/balance", description: "Get balance" },
    ];
    await store.put("stripe.com", record);
    const results = await store.search("charge");
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("stripe.com");
    expect(results[0].matchedEndpoints).toHaveLength(2);
    expect(results[0].matchedEndpoints).toEqual([
      { method: "POST", path: "/charges", description: "Create a charge" },
      { method: "GET", path: "/charges/{id}", description: "Retrieve a charge" },
    ]);
  });

  it("should search by endpoint method", async () => {
    const record = makeRecord("api.example.com", { description: "Example API" });
    record.endpoints = [
      { method: "DELETE", path: "/users/{id}", description: "Remove user" },
      { method: "GET", path: "/users", description: "List users" },
    ];
    await store.put("api.example.com", record);
    const results = await store.search("DELETE");
    expect(results).toHaveLength(1);
    expect(results[0].matchedEndpoints).toEqual([
      { method: "DELETE", path: "/users/{id}", description: "Remove user" },
    ]);
  });

  it("should search by endpoint path", async () => {
    const record = makeRecord("api.weather.gov", { description: "Weather API" });
    record.endpoints = [
      { method: "GET", path: "/alerts/active", description: "Active alerts" },
      { method: "GET", path: "/alerts/{id}", description: "Single alert" },
      { method: "GET", path: "/stations", description: "Weather stations" },
    ];
    await store.put("api.weather.gov", record);
    const results = await store.search("alerts");
    expect(results).toHaveLength(1);
    expect(results[0].matchedEndpoints).toHaveLength(2);
    expect(results[0].matchedEndpoints[0].path).toBe("/alerts/active");
    expect(results[0].matchedEndpoints[1].path).toBe("/alerts/{id}");
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
});
