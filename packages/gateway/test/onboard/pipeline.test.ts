import { describe, it, expect, beforeEach } from "vitest";
import { OnboardPipeline } from "../../src/onboard/pipeline.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { MemoryCredentialVault } from "../../src/credential/memory-vault.js";
import type { ManifestEntry } from "../../src/onboard/types.js";

const PETSTORE_SPEC = {
  openapi: "3.0.0",
  info: { title: "Petstore", description: "A pet store", version: "1.0.0" },
  paths: {
    "/pets": { get: { summary: "List pets" }, post: { summary: "Create pet" } },
    "/pets/{petId}": { get: { summary: "Get pet" } },
  },
};

function mockFetch(overrides?: Record<string, { status: number; body: any; contentType?: string }>) {
  return async (url: string) => {
    for (const [pattern, resp] of Object.entries(overrides ?? {})) {
      if (url.includes(pattern)) {
        const ct = resp.contentType ?? "application/json";
        const body = ct.includes("json") ? JSON.stringify(resp.body) : resp.body;
        return new Response(body, {
          status: resp.status,
          headers: { "Content-Type": ct },
        });
      }
    }
    return new Response(JSON.stringify(PETSTORE_SPEC), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("OnboardPipeline", () => {
  let store: MemoryRegistryStore;
  let vault: MemoryCredentialVault;

  beforeEach(() => {
    store = new MemoryRegistryStore();
    vault = new MemoryCredentialVault();
  });

  it("should onboard a service from OpenAPI spec URL", async () => {
    const pipeline = new OnboardPipeline({
      store,
      vault,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({
      domain: "petstore.com",
      specUrl: "https://petstore.com/openapi.json",
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("openapi");
    expect(result.endpoints).toBe(3);
    expect(result.resources).toBeGreaterThan(0);

    // Verify service is registered
    const record = await store.get("petstore.com");
    expect(record).not.toBeNull();
    expect(record!.name).toBe("Petstore");
  });

  it("should onboard a service from inline skill.md", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({
      domain: "acme.com",
      skillMd: `---
name: "Acme"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme

A service.

## API

### Get data

\`GET /api/data\` — public
`,
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("skillmd");
    expect(result.endpoints).toBe(1);
  });

  it("should store pool credentials from manifest", async () => {
    const pipeline = new OnboardPipeline({
      store,
      vault,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({
      domain: "petstore.com",
      specUrl: "https://petstore.com/openapi.json",
      auth: { type: "bearer", token: "secret-123" },
    });

    expect(result.status).toBe("ok");
    expect(result.hasCredentials).toBe(true);

    // Verify credential is stored
    const cred = await vault.get("petstore.com");
    expect(cred).not.toBeNull();
    expect(cred!.auth).toEqual({ type: "bearer", token: "secret-123" });
  });

  it("should resolve ${ENV_VAR} in auth", async () => {
    process.env._TEST_TOKEN = "resolved-secret";
    const pipeline = new OnboardPipeline({
      store,
      vault,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({
      domain: "petstore.com",
      specUrl: "https://petstore.com/openapi.json",
      auth: { type: "bearer", token: "${_TEST_TOKEN}" },
    });

    expect(result.status).toBe("ok");
    const cred = await vault.get("petstore.com");
    expect(cred!.auth).toEqual({ type: "bearer", token: "resolved-secret" });
    delete process.env._TEST_TOKEN;
  });

  it("should skip disabled entries", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({
      domain: "skip.com",
      specUrl: "https://skip.com/openapi.json",
      disabled: true,
    });

    expect(result.status).toBe("skipped");
  });

  it("should report failure on bad spec URL", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      fetchFn: mockFetch({
        "bad.com": { status: 404, body: "not found" },
      }) as any,
    });

    const result = await pipeline.onboardOne({
      domain: "bad.com",
      specUrl: "https://bad.com/openapi.json",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("404");
  });

  it("should skip entries with no source", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({ domain: "empty.com" });
    expect(result.status).toBe("skipped");
  });

  it("should run smoke test on registered service", async () => {
    const pipeline = new OnboardPipeline({
      store,
      vault,
      smokeTest: true,
      fetchFn: mockFetch() as any,
    });

    const result = await pipeline.onboardOne({
      domain: "petstore.com",
      specUrl: "https://petstore.com/openapi.json",
    });

    expect(result.status).toBe("ok");
    // Smoke test ls should work (returns local resources)
    expect(result.smokeTest?.ls).toBe(true);
  });

  it("should process batch with concurrency", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      concurrency: 2,
      fetchFn: mockFetch() as any,
    });

    const entries: ManifestEntry[] = [
      { domain: "api1.com", specUrl: "https://api1.com/spec.json" },
      { domain: "api2.com", specUrl: "https://api2.com/spec.json" },
      { domain: "api3.com", specUrl: "https://api3.com/spec.json" },
      { domain: "skip.com", disabled: true },
    ];

    const report = await pipeline.onboardMany(entries);

    expect(report.total).toBe(4);
    expect(report.ok).toBe(3);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should onboard a service from RPC definition", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
    });

    const result = await pipeline.onboardOne({
      domain: "rpc.example.com",
      rpcDef: {
        url: "https://rpc.example.com/eth",
        convention: "evm",
        methods: [
          { rpcMethod: "eth_blockNumber", description: "Latest block", resource: "blocks", fsOp: "list" },
          { rpcMethod: "eth_getBlockByNumber", description: "Get block", resource: "blocks", fsOp: "read" },
          { rpcMethod: "eth_getBalance", description: "Get balance", resource: "balances", fsOp: "read" },
          { rpcMethod: "eth_chainId", description: "Chain ID" },
        ],
      },
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("jsonrpc");
    expect(result.endpoints).toBe(4);
    expect(result.resources).toBeGreaterThan(0);

    // Verify service is registered with RPC source metadata
    const record = await store.get("rpc.example.com");
    expect(record).not.toBeNull();
    expect(record!.source?.type).toBe("jsonrpc");
    expect(record!.source?.rpc?.convention).toBe("evm");
    expect(record!.source?.rpc?.rpcUrl).toBe("https://rpc.example.com/eth");

    // Verify resources are compiled
    const blocks = record!.source?.rpc?.resources.find((r) => r.name === "blocks");
    expect(blocks).toBeDefined();
    expect(blocks!.methods).toEqual({
      list: "eth_blockNumber",
      read: "eth_getBlockByNumber",
    });
  });

  it("should include RPC services in batch onboard", async () => {
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      fetchFn: mockFetch() as any,
    });

    const entries: ManifestEntry[] = [
      { domain: "api.example.com", specUrl: "https://api.example.com/spec.json" },
      {
        domain: "rpc.example.com",
        rpcDef: {
          url: "https://rpc.example.com",
          convention: "evm",
          methods: [
            { rpcMethod: "eth_blockNumber", description: "Latest block", resource: "blocks", fsOp: "list" },
          ],
        },
      },
    ];

    const report = await pipeline.onboardMany(entries);
    expect(report.ok).toBe(2);
    expect(report.results[0].source).toBe("openapi");
    expect(report.results[1].source).toBe("jsonrpc");
  });

  it("should call onProgress callback", async () => {
    const progress: { domain: string; index: number }[] = [];
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      fetchFn: mockFetch() as any,
      onProgress: (result, index) => {
        progress.push({ domain: result.domain, index });
      },
    });

    await pipeline.onboardMany([
      { domain: "a.com", specUrl: "https://a.com/spec.json" },
      { domain: "b.com", specUrl: "https://b.com/spec.json" },
    ]);

    expect(progress).toHaveLength(2);
  });
});
