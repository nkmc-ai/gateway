import { describe, it, expect, beforeEach } from "vitest";
import { SourceRefresher } from "../../src/registry/source-refresher.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import type { ServiceRecord } from "../../src/registry/types.js";

function makeRecord(domain: string, overrides?: Partial<ServiceRecord>): ServiceRecord {
  return {
    domain,
    name: overrides?.name ?? domain,
    description: overrides?.description ?? `Service ${domain}`,
    version: overrides?.version ?? "1.0",
    roles: ["agent"],
    skillMd: "---\nname: test\n---\n# Test\n\nTest service.\n",
    endpoints: [],
    isFirstParty: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
    isDefault: true,
    ...overrides,
  };
}

describe("SourceRefresher", () => {
  let store: MemoryRegistryStore;

  beforeEach(() => {
    store = new MemoryRegistryStore();
  });

  it("should not refresh without source config", async () => {
    const record = makeRecord("test.com");
    const refresher = new SourceRefresher(store);
    expect(await refresher.shouldRefresh(record)).toBe(false);
  });

  it("should not refresh when interval has not elapsed", async () => {
    const record = makeRecord("test.com", {
      source: { type: "openapi", url: "https://test.com/spec.json", refreshInterval: 3600, lastRefresh: Date.now() },
    });
    const refresher = new SourceRefresher(store);
    expect(await refresher.shouldRefresh(record)).toBe(false);
  });

  it("should refresh when interval has elapsed", async () => {
    const record = makeRecord("test.com", {
      source: { type: "openapi", url: "https://test.com/spec.json", refreshInterval: 1, lastRefresh: Date.now() - 2000 },
    });
    const refresher = new SourceRefresher(store);
    expect(await refresher.shouldRefresh(record)).toBe(true);
  });

  it("should refresh openapi source", async () => {
    const spec = { info: { title: "Updated", version: "2.0" }, paths: {} };
    const mockFetch = async () => new Response(JSON.stringify(spec), { status: 200, headers: { "Content-Type": "application/json" } });

    const record = makeRecord("test.com", {
      source: { type: "openapi", url: "https://test.com/spec.json", refreshInterval: 1 },
    });
    await store.put("test.com", record);

    const refresher = new SourceRefresher(store, mockFetch as any);
    const updated = await refresher.refresh(record);
    expect(updated?.name).toBe("Updated");
    expect(updated?.source?.lastRefresh).toBeGreaterThan(0);
  });

  it("should refresh wellknown source", async () => {
    const skillMd = '---\nname: "Refreshed"\nversion: "2.0"\nroles: [agent]\n---\n\n# Refreshed\n\nRefreshed service.\n';
    const mockFetch = async () => new Response(skillMd, { status: 200 });

    const record = makeRecord("test.com", {
      source: { type: "wellknown", url: "https://test.com/.well-known/skill.md", refreshInterval: 1 },
    });
    await store.put("test.com", record);

    const refresher = new SourceRefresher(store, mockFetch as any);
    const updated = await refresher.refresh(record);
    expect(updated?.name).toBe("Refreshed");
  });

  it("should return null for unknown source type", async () => {
    const record = makeRecord("test.com", {
      source: { type: "skillmd" },
    });
    const refresher = new SourceRefresher(store);
    const result = await refresher.refresh(record);
    expect(result).toBeNull();
  });
});
