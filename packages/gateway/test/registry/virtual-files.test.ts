import { describe, it, expect, beforeEach } from "vitest";
import { VirtualFileBackend } from "../../src/registry/virtual-files.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { parseSkillMd } from "../../src/registry/skill-parser.js";
import type { FsBackend } from "@nkmc/agent-fs";

const SKILL_MD = `---
name: "Test API"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Test API

A test service.

## API

### List items

\`GET /api/items\` — free

### Create order

\`POST /api/orders\` — 0.05 USDC / call
`;

class MockBackend implements FsBackend {
  async list(_path: string): Promise<string[]> { return ["items/", "_api/"]; }
  async read(_path: string): Promise<unknown> { return { mock: true }; }
  async write(_path: string, _data: unknown): Promise<{id: string}> { return { id: "1" }; }
  async remove(_path: string): Promise<void> {}
  async search(_path: string, _pattern: string): Promise<unknown[]> { return []; }
}

describe("VirtualFileBackend", () => {
  let store: MemoryRegistryStore;
  let inner: MockBackend;
  let backend: VirtualFileBackend;

  beforeEach(async () => {
    store = new MemoryRegistryStore();
    const record = parseSkillMd("test-api.com", SKILL_MD);
    await store.put("test-api.com", record);

    inner = new MockBackend();
    backend = new VirtualFileBackend({ inner, domain: "test-api.com", store });
  });

  it("should append virtual files to root listing", async () => {
    const entries = await backend.list("/");
    expect(entries).toContain("items/");
    expect(entries).toContain("_api/");
    expect(entries).toContain("_pricing.json");
    expect(entries).toContain("_versions.json");
  });

  it("should not append virtual files to non-root listing", async () => {
    const entries = await backend.list("/items");
    expect(entries).not.toContain("_pricing.json");
  });

  it("should read _pricing.json", async () => {
    const data = await backend.read("/_pricing.json") as any;
    expect(data.domain).toBe("test-api.com");
    expect(data.endpoints.length).toBeGreaterThan(0);
    expect(data.endpoints[0].pricing).toBeDefined();
  });

  it("should read _versions.json", async () => {
    const data = await backend.read("/_versions.json") as any;
    expect(data.domain).toBe("test-api.com");
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].version).toBe("1.0");
  });

  it("should delegate non-virtual reads to inner backend", async () => {
    const data = await backend.read("/items/1.json");
    expect(data).toEqual({ mock: true });
  });

  it("should delegate write to inner backend", async () => {
    const result = await backend.write("/items/", { name: "test" });
    expect(result.id).toBe("1");
  });

  it("should delegate remove to inner backend", async () => {
    await expect(backend.remove("/items/1")).resolves.toBeUndefined();
  });

  it("should delegate search to inner backend", async () => {
    const results = await backend.search("/items", "test");
    expect(results).toEqual([]);
  });
});
