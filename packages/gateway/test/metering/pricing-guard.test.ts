import { describe, it, expect } from "vitest";
import { lookupPricing, checkAccess, meter } from "../../src/metering/pricing-guard.js";
import { MemoryMeterStore } from "../../src/metering/memory-store.js";
import type { ServiceRecord } from "../../src/registry/types.js";

function makeRecord(overrides?: Partial<ServiceRecord>): ServiceRecord {
  return {
    domain: "api.example.com",
    name: "Example API",
    description: "Test",
    version: "1.0",
    roles: ["agent"],
    skillMd: "",
    endpoints: [
      { method: "GET", path: "/api/data", description: "Get data" },
      { method: "POST", path: "/api/orders", description: "Create order", pricing: { cost: 0.05, currency: "USDC", per: "call" } },
      { method: "GET", path: "/api/users/:id", description: "Get user", pricing: { cost: 0.01, currency: "USDC", per: "call" } },
    ],
    isFirstParty: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
    isDefault: true,
    ...overrides,
  };
}

describe("lookupPricing", () => {
  it("should return pricing for paid endpoint", () => {
    const record = makeRecord();
    const pricing = lookupPricing(record, "POST", "/api/orders");
    expect(pricing).toEqual({ cost: 0.05, currency: "USDC", per: "call" });
  });

  it("should return null for free endpoint", () => {
    const record = makeRecord();
    const pricing = lookupPricing(record, "GET", "/api/data");
    expect(pricing).toBeNull();
  });

  it("should match path with :param", () => {
    const record = makeRecord();
    const pricing = lookupPricing(record, "GET", "/api/users/123");
    expect(pricing).toEqual({ cost: 0.01, currency: "USDC", per: "call" });
  });

  it("should return null for unknown endpoint", () => {
    const record = makeRecord();
    const pricing = lookupPricing(record, "DELETE", "/api/unknown");
    expect(pricing).toBeNull();
  });
});

describe("checkAccess", () => {
  it("should allow active services", () => {
    const record = makeRecord({ status: "active" });
    expect(checkAccess(record).allowed).toBe(true);
  });

  it("should deny sunset services", () => {
    const record = makeRecord({ status: "sunset" });
    const result = checkAccess(record);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("sunset");
  });

  it("should deny when sunset date has passed", () => {
    const record = makeRecord({ sunsetDate: Date.now() - 1000 });
    const result = checkAccess(record);
    expect(result.allowed).toBe(false);
  });

  it("should allow when sunset date is in the future", () => {
    const record = makeRecord({ sunsetDate: Date.now() + 86400000 });
    expect(checkAccess(record).allowed).toBe(true);
  });
});

describe("meter", () => {
  it("should record a meter entry", async () => {
    const store = new MemoryMeterStore();
    const entry = await meter(store, {
      domain: "api.example.com",
      version: "1.0",
      endpoint: "POST /api/orders",
      agentId: "agent-1",
      pricing: { cost: 0.05, currency: "USDC", per: "call" },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.cost).toBe(0.05);

    const records = await store.query({ domain: "api.example.com" });
    expect(records).toHaveLength(1);
  });

  it("should include developerId when provided", async () => {
    const store = new MemoryMeterStore();
    const entry = await meter(store, {
      domain: "api.example.com",
      version: "1.0",
      endpoint: "POST /api/orders",
      agentId: "agent-1",
      developerId: "dev-1",
      pricing: { cost: 0.05, currency: "USDC", per: "call" },
    });
    expect(entry.developerId).toBe("dev-1");
  });
});
