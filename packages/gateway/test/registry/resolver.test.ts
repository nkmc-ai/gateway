import { describe, it, expect, beforeEach } from "vitest";
import { AgentFs } from "@nkmc/agent-fs";
import { MemoryBackend } from "@nkmc/agent-fs/testing";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { parseSkillMd } from "../../src/registry/skill-parser.js";
import { createRegistryResolver, extractDomainPath } from "../../src/registry/resolver.js";

const ACME_SKILL = `---
name: "Acme Store"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme Store

E-commerce store.

## API

### List products

\`GET /api/products\` — 免費，public

### Create order

\`POST /api/orders\` — 0.05 USDC / 次，agent
`;

describe("RegistryResolver", () => {
  let store: MemoryRegistryStore;

  beforeEach(async () => {
    store = new MemoryRegistryStore();
    const record = parseSkillMd("acme-store.com", ACME_SKILL);
    await store.put("acme-store.com", record);
  });

  it("should create AgentFs hooks from RegistryStore", async () => {
    const { onMiss, listDomains } = createRegistryResolver(store);
    expect(typeof onMiss).toBe("function");
    expect(typeof listDomains).toBe("function");
  });

  it("listDomains should return registered domains", async () => {
    const { listDomains } = createRegistryResolver(store);
    const domains = await listDomains();
    expect(domains).toContain("acme-store.com");
  });

  it("onMiss should create HttpBackend for known domain", async () => {
    const { onMiss } = createRegistryResolver(store);
    let mountAdded = false;
    const added = await onMiss("/acme-store.com/products", (mount) => {
      mountAdded = true;
      expect(mount.path).toBe("/acme-store.com");
    });
    expect(added).toBe(true);
    expect(mountAdded).toBe(true);
  });

  it("onMiss should return false for unknown domain", async () => {
    const { onMiss } = createRegistryResolver(store);
    const added = await onMiss("/unknown.com/test", () => {});
    expect(added).toBe(false);
  });

  it("onMiss should cache — not recreate backend for same domain", async () => {
    const { onMiss } = createRegistryResolver(store);
    let addCount = 0;
    const addMount = () => {
      addCount++;
    };
    await onMiss("/acme-store.com/products", addMount);
    await onMiss("/acme-store.com/orders", addMount);
    expect(addCount).toBe(1); // Only first call creates the mount
  });

  it("should work end-to-end with AgentFs for ls /", async () => {
    const { onMiss, listDomains } = createRegistryResolver(store);
    const staticBackend = new MemoryBackend();

    const fs = new AgentFs({
      mounts: [{ path: "/memory", backend: staticBackend }],
      onMiss,
      listDomains,
    });

    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entries = result.data as string[];
      expect(entries).toContain("memory/");
      expect(entries).toContain("acme-store.com/");
    }
  });

  it("grep on root should search registry and return SearchResult", async () => {
    const { onMiss, listDomains, searchDomains } =
      createRegistryResolver(store);
    const fs = new AgentFs({
      mounts: [],
      onMiss,
      listDomains,
      searchDomains,
    });

    const result = await fs.execute('grep "e-commerce" /');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { domain: string; matchedEndpoints: unknown[] }[];
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].domain).toBe("acme-store.com");
      // "e-commerce" matches service description, not specific endpoints
      expect(data[0].matchedEndpoints).toEqual([]);
    }
  });

  it("grep on root should return matchedEndpoints when query matches endpoint", async () => {
    const { searchDomains } = createRegistryResolver(store);
    const results = await searchDomains("products");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchedEndpoints.length).toBeGreaterThan(0);
    expect(results[0].matchedEndpoints[0].path).toBe("/api/products");
  });

  it("searchEndpoints should filter endpoints within a domain", async () => {
    const { searchEndpoints } = createRegistryResolver(store);
    const results = await searchEndpoints("acme-store.com", "products");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      method: "GET",
      path: "/api/products",
      description: expect.any(String),
    });
  });

  it("searchEndpoints should return empty for unknown domain", async () => {
    const { searchEndpoints } = createRegistryResolver(store);
    const results = await searchEndpoints("unknown.com", "test");
    expect(results).toEqual([]);
  });

  it("searchEndpoints should return empty when no endpoints match", async () => {
    const { searchEndpoints } = createRegistryResolver(store);
    const results = await searchEndpoints("acme-store.com", "zzzzz");
    expect(results).toEqual([]);
  });

  it("searchEndpoints should work end-to-end with AgentFs for domain grep", async () => {
    const { onMiss, listDomains, searchDomains, searchEndpoints } =
      createRegistryResolver(store);
    const fs = new AgentFs({
      mounts: [],
      onMiss,
      listDomains,
      searchDomains,
      searchEndpoints,
    });

    const result = await fs.execute('grep "orders" /acme-store.com/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { method: string; path: string }[];
      expect(data).toHaveLength(1);
      expect(data[0].method).toBe("POST");
      expect(data[0].path).toBe("/api/orders");
    }
  });

  it("onMiss should reject sunset services", async () => {
    const record = parseSkillMd("old-api.com", ACME_SKILL);
    (record as any).status = "sunset";
    (record as any).domain = "old-api.com";
    await store.put("old-api.com", record);

    const { onMiss } = createRegistryResolver(store);
    const added = await onMiss("/old-api.com/test", () => {});
    expect(added).toBe(false);
  });

  it("should accept RegistryResolverOptions object", async () => {
    const { onMiss, listDomains } = createRegistryResolver({ store });
    const domains = await listDomains();
    expect(domains).toContain("acme-store.com");

    let mounted = false;
    await onMiss("/acme-store.com/test", () => { mounted = true; });
    expect(mounted).toBe(true);
  });
});

describe("extractDomainPath", () => {
  it("should extract domain without version", () => {
    expect(extractDomainPath("/api.cloudflare.com/zones/")).toEqual({
      domain: "api.cloudflare.com",
      version: null,
    });
  });

  it("should extract domain with @version", () => {
    expect(extractDomainPath("/api.cloudflare.com@v5/zones/")).toEqual({
      domain: "api.cloudflare.com",
      version: "v5",
    });
  });

  it("should return null for empty path", () => {
    expect(extractDomainPath("/")).toEqual({
      domain: null,
      version: null,
    });
  });

  it("should handle bare domain", () => {
    expect(extractDomainPath("/acme.com")).toEqual({
      domain: "acme.com",
      version: null,
    });
  });

  it("should handle domain@version without trailing path", () => {
    expect(extractDomainPath("/acme.com@2.0")).toEqual({
      domain: "acme.com",
      version: "2.0",
    });
  });
});
