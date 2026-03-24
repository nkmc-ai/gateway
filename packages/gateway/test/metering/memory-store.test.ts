import { describe, it, expect, beforeEach } from "vitest";
import { MemoryMeterStore } from "../../src/metering/memory-store.js";
import type { MeterRecord } from "../../src/metering/types.js";

function makeEntry(overrides?: Partial<MeterRecord>): MeterRecord {
  return {
    id: overrides?.id ?? `m_${Date.now()}`,
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

describe("MemoryMeterStore", () => {
  let store: MemoryMeterStore;

  beforeEach(() => {
    store = new MemoryMeterStore();
  });

  it("should record and query entries", async () => {
    await store.record(makeEntry({ id: "m1" }));
    await store.record(makeEntry({ id: "m2" }));
    const results = await store.query({});
    expect(results).toHaveLength(2);
  });

  it("should filter by domain", async () => {
    await store.record(makeEntry({ id: "m1", domain: "api.example.com" }));
    await store.record(makeEntry({ id: "m2", domain: "other.com" }));
    const results = await store.query({ domain: "api.example.com" });
    expect(results).toHaveLength(1);
    expect(results[0].domain).toBe("api.example.com");
  });

  it("should filter by agentId", async () => {
    await store.record(makeEntry({ id: "m1", agentId: "agent-1" }));
    await store.record(makeEntry({ id: "m2", agentId: "agent-2" }));
    const results = await store.query({ agentId: "agent-1" });
    expect(results).toHaveLength(1);
  });

  it("should filter by time range", async () => {
    await store.record(makeEntry({ id: "m1", timestamp: 1000 }));
    await store.record(makeEntry({ id: "m2", timestamp: 2000 }));
    await store.record(makeEntry({ id: "m3", timestamp: 3000 }));
    const results = await store.query({ from: 1500, to: 2500 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("m2");
  });

  it("should sum costs", async () => {
    await store.record(makeEntry({ id: "m1", cost: 0.05 }));
    await store.record(makeEntry({ id: "m2", cost: 0.10 }));
    const { total, currency } = await store.sum({});
    expect(total).toBeCloseTo(0.15);
    expect(currency).toBe("USDC");
  });

  it("should sum with filter", async () => {
    await store.record(makeEntry({ id: "m1", domain: "a.com", cost: 0.05 }));
    await store.record(makeEntry({ id: "m2", domain: "b.com", cost: 0.10 }));
    const { total } = await store.sum({ domain: "a.com" });
    expect(total).toBeCloseTo(0.05);
  });

  it("should return zero sum for no matches", async () => {
    const { total } = await store.sum({ domain: "nonexistent.com" });
    expect(total).toBe(0);
  });
});
