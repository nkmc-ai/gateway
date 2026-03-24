import { describe, it, expect } from "vitest";
import { HttpBackend } from "../src/backends/http.js";

function createMockFetch(responses: Record<string, { status: number; body: any }>) {
  return async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    // Try exact match first, then URL only
    const resp = responses[key] ?? responses[url];
    if (!resp) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(resp.body), { status: resp.status, headers: { "Content-Type": "application/json" } });
  };
}

describe("HttpBackend Passthrough", () => {
  it("should list root resources/endpoints when resources exist", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [{ name: "users" }],
      fetch: createMockFetch({}) as any,
    });
    const entries = await backend.list("/");
    expect(entries).toContain("users/");
  });

  it("should passthrough list when no resources or endpoints", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({
        "GET https://api.example.com/items": { status: 200, body: [{ id: "1" }, { id: "2" }] },
      }) as any,
    });
    const entries = await backend.list("/items");
    expect(entries).toEqual(["1", "2"]);
  });

  it("should passthrough read when no resources or endpoints", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({
        "GET https://api.example.com/items/1": { status: 200, body: { id: "1", name: "Test" } },
      }) as any,
    });
    const result = await backend.read("/items/1");
    expect(result).toEqual({ id: "1", name: "Test" });
  });

  it("should passthrough write when no resources or endpoints", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({
        "PUT https://api.example.com/items/1": { status: 200, body: { id: "1" } },
      }) as any,
    });
    const result = await backend.write("/items/1", { name: "Updated" });
    expect(result.id).toBe("1");
  });

  it("should passthrough POST to root path for create", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({
        "POST https://api.example.com/": { status: 201, body: { id: "new-1" } },
      }) as any,
    });
    const result = await backend.write("/", { name: "New" });
    expect(result.id).toBe("new-1");
  });

  it("should passthrough remove when no resources or endpoints", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({
        "DELETE https://api.example.com/items/1": { status: 200, body: { ok: true } },
      }) as any,
    });
    await expect(backend.remove("/items/1")).resolves.toBeUndefined();
  });

  it("should passthrough search when no resources or endpoints", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({
        "GET https://api.example.com/items?q=test": { status: 200, body: [{ id: "1" }] },
      }) as any,
    });
    const results = await backend.search("/items", "test");
    expect(results).toEqual([{ id: "1" }]);
  });

  it("should still show root listing in passthrough mode", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [],
      endpoints: [],
      fetch: createMockFetch({}) as any,
    });
    const entries = await backend.list("/");
    expect(entries).toEqual([]);
  });
});

describe("HttpBackend Passthrough Fallback (resources exist but path unmatched)", () => {
  it("should fallback to passthrough for multi-segment paths that don't match resources", async () => {
    // Simulates: repos resource exists, but /repos/facebook/react has 2 segments after resource
    const backend = new HttpBackend({
      baseUrl: "https://api.github.com",
      resources: [{ name: "repos" }],
      endpoints: [],
      fetch: createMockFetch({
        "GET https://api.github.com/orgs/facebook/repos": {
          status: 200,
          body: [{ id: 1, name: "react" }],
        },
      }) as any,
    });
    // "orgs" is NOT a defined resource, so it should passthrough
    const result = await backend.read("/orgs/facebook/repos");
    expect(result).toEqual([{ id: 1, name: "react" }]);
  });

  it("should still use resource resolution for matching paths", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [{ name: "users" }],
      fetch: createMockFetch({
        "GET https://api.example.com/users": { status: 200, body: [{ id: "1" }] },
      }) as any,
    });
    // "users" matches a resource — should use resource-list, not passthrough
    const entries = await backend.list("/users/");
    expect(entries).toEqual(["1.json"]);
  });

  it("should passthrough write for unmatched paths even when resources exist", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [{ name: "users" }],
      fetch: createMockFetch({
        "PUT https://api.example.com/teams/5/members": { status: 200, body: { id: "m1" } },
      }) as any,
    });
    // "teams" is NOT a defined resource
    const result = await backend.write("/teams/5/members", { userId: "1" });
    expect(result.id).toBe("m1");
  });

  it("should passthrough delete for unmatched paths even when resources exist", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [{ name: "users" }],
      fetch: createMockFetch({
        "DELETE https://api.example.com/teams/5/members/m1": { status: 200, body: { ok: true } },
      }) as any,
    });
    await expect(backend.remove("/teams/5/members/m1")).resolves.toBeUndefined();
  });

  it("should throw NotFoundError when passthrough gets 404 from upstream", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [{ name: "users" }],
      fetch: createMockFetch({}) as any, // no matching response → 404
    });
    await expect(backend.read("/nonexistent/path")).rejects.toThrow();
  });
});

describe("HttpBackend Passthrough — resource matches but unconsumed segments", () => {
  // This is the critical case: first segment matches a resource, but extra
  // segments remain that the resource tree cannot consume. The resource layer
  // must yield to passthrough instead of silently dropping segments.

  it("should passthrough read when matched resource has unconsumed segments", async () => {
    // "repos" is a defined resource, but /repos/facebook/react has 2 segments
    // after "repos" — resource layer can only consume 1 (the id).
    const backend = new HttpBackend({
      baseUrl: "https://api.github.com",
      resources: [{ name: "repos" }],
      fetch: createMockFetch({
        "GET https://api.github.com/repos/facebook/react": {
          status: 200,
          body: { id: 1, full_name: "facebook/react" },
        },
      }) as any,
    });
    const result = await backend.read("/repos/facebook/react");
    expect(result).toEqual({ id: 1, full_name: "facebook/react" });
  });

  it("should passthrough deeply nested paths past a matched resource", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.github.com",
      resources: [{ name: "repos" }],
      fetch: createMockFetch({
        "GET https://api.github.com/repos/facebook/react/issues": {
          status: 200,
          body: [{ id: 42, title: "Bug" }],
        },
      }) as any,
    });
    const result = await backend.read("/repos/facebook/react/issues");
    expect(result).toEqual([{ id: 42, title: "Bug" }]);
  });

  it("should passthrough list for unconsumed segments past a resource", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.github.com",
      resources: [{ name: "repos" }],
      fetch: createMockFetch({
        "GET https://api.github.com/repos/facebook/react/pulls": {
          status: 200,
          body: [{ id: 10, title: "PR" }, { id: 11, title: "PR2" }],
        },
      }) as any,
    });
    const entries = await backend.list("/repos/facebook/react/pulls");
    expect(entries).toEqual(["10", "11"]);
  });

  it("should passthrough write for unconsumed segments past a resource", async () => {
    const backend = new HttpBackend({
      baseUrl: "https://api.github.com",
      resources: [{ name: "repos" }],
      fetch: createMockFetch({
        "PUT https://api.github.com/repos/facebook/react/issues/42": {
          status: 200,
          body: { id: 42 },
        },
      }) as any,
    });
    const result = await backend.write("/repos/facebook/react/issues/42", { state: "closed" });
    expect(result.id).toBe("42");
  });

  it("should still use resource-item for exact 2-segment match", async () => {
    // repos/123 → resource-item (only 1 segment after resource name, fully consumed)
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      resources: [{ name: "repos" }],
      fetch: createMockFetch({
        "GET https://api.example.com/repos/123": {
          status: 200,
          body: { id: 123, name: "my-repo" },
        },
      }) as any,
    });
    const result = await backend.read("/repos/123");
    expect(result).toEqual({ id: 123, name: "my-repo" });
  });

  it("should use children when defined, not passthrough", async () => {
    // zones/{id}/dns_records → children match, should NOT passthrough
    const backend = new HttpBackend({
      baseUrl: "https://api.cloudflare.com/client/v4",
      resources: [{
        name: "zones",
        children: [{ name: "dns_records" }],
      }],
      fetch: createMockFetch({
        "GET https://api.cloudflare.com/client/v4/zones/z1/dns_records": {
          status: 200,
          body: [{ id: "r1", type: "A" }],
        },
      }) as any,
    });
    const entries = await backend.list("/zones/z1/dns_records/");
    expect(entries).toEqual(["r1.json"]);
  });
});
