/**
 * E2E: onboard real APIs from apis.guru, then interact via AgentFs.
 */
import { describe, it, expect } from "vitest";
import { OnboardPipeline } from "../../src/onboard/pipeline.js";
import { discoverFromApisGuru } from "../../src/onboard/apis-guru.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import { AgentFs } from "@nkmc/agent-fs";

describe("Onboard E2E: apis.guru → AgentFs (real network)", () => {
  it("should discover, onboard, and browse a real public API", async () => {
    const store = new MemoryRegistryStore();

    // 1. Discover — pick a known small API
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
    });

    const result = await pipeline.onboardOne({
      domain: "petstore3.swagger.io",
      specUrl: "https://petstore3.swagger.io/api/v3/openapi.json",
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("openapi");
    expect(result.endpoints).toBeGreaterThan(0);
    expect(result.resources).toBeGreaterThan(0);

    // 2. Browse via AgentFs
    const { onMiss, listDomains } = createRegistryResolver({ store, wrapVirtualFiles: false });
    const fs = new AgentFs({ mounts: [], onMiss, listDomains });

    // ls / — should show the registered service
    const lsRoot = await fs.execute("ls /");
    expect(lsRoot.ok).toBe(true);
    expect(lsRoot.data).toContain("petstore3.swagger.io/");

    // ls /domain/ — should show resources from the spec
    const lsDomain = await fs.execute("ls /petstore3.swagger.io/");
    expect(lsDomain.ok).toBe(true);
    const entries = lsDomain.data as string[];
    expect(entries.some((e) => e.includes("pet"))).toBe(true);
    expect(entries).toContain("_api/");
  }, 30_000);

  it("should batch-onboard multiple APIs from apis.guru", async () => {
    // Discover 3 APIs with keyword filter
    const entries = await discoverFromApisGuru({ limit: 3 });
    expect(entries.length).toBeGreaterThan(0);

    const store = new MemoryRegistryStore();
    const pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      concurrency: 3,
    });

    const report = await pipeline.onboardMany(entries);

    // At least some should succeed (some specs might be unreachable)
    expect(report.total).toBe(entries.length);
    expect(report.ok).toBeGreaterThan(0);

    // Verify store has services
    const services = await store.list();
    expect(services.length).toBe(report.ok);
  }, 60_000);
});
