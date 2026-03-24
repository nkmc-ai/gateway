import { describe, it, expect } from "vitest";
import { discoverFromApisGuru } from "../../src/onboard/apis-guru.js";

const MOCK_CATALOG = {
  "petstore.com:1.0.0": {
    preferred: "1.0.0",
    versions: {
      "1.0.0": {
        swaggerUrl: "https://petstore.com/openapi.json",
        info: { title: "Petstore", description: "A pet store API" },
      },
    },
  },
  "weather.com:2.0": {
    preferred: "2.0",
    versions: {
      "2.0": {
        swaggerUrl: "https://weather.com/v2/openapi.json",
        info: { title: "Weather API", description: "Global weather data" },
      },
    },
  },
  "nospec.com:1.0": {
    preferred: "1.0",
    versions: { "1.0": { info: { title: "No Spec" } } },
  },
};

function mockFetch() {
  return async () =>
    new Response(JSON.stringify(MOCK_CATALOG), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

describe("discoverFromApisGuru", () => {
  it("should discover APIs from catalog", async () => {
    const entries = await discoverFromApisGuru({ fetchFn: mockFetch() as any });
    // nospec.com has no swaggerUrl → skipped
    expect(entries).toHaveLength(2);
    expect(entries[0].domain).toBe("petstore.com");
    expect(entries[0].specUrl).toBe("https://petstore.com/openapi.json");
    expect(entries[0].tags).toContain("apis-guru");
  });

  it("should respect limit", async () => {
    const entries = await discoverFromApisGuru({ limit: 1, fetchFn: mockFetch() as any });
    expect(entries).toHaveLength(1);
  });

  it("should filter by keyword", async () => {
    const entries = await discoverFromApisGuru({ filter: "weather", fetchFn: mockFetch() as any });
    expect(entries).toHaveLength(1);
    expect(entries[0].domain).toBe("weather.com");
  });
});
