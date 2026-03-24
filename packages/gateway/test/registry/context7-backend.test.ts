import { describe, it, expect } from "vitest";
import { Context7Backend } from "../../src/registry/context7-backend.js";

function createMockFetch(handlers: Record<string, (url: string, init?: RequestInit) => Response>) {
  return async (url: string, init?: RequestInit) => {
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) return handler(url, init);
    }
    return new Response("not found", { status: 404 });
  };
}

describe("Context7Backend", () => {
  it("list / should return usage instructions", async () => {
    const backend = new Context7Backend({ fetchFn: (() => {}) as any });
    const entries = await backend.list("/");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.includes("grep"))).toBe(true);
  });

  it("search / should search libraries", async () => {
    const backend = new Context7Backend({
      fetchFn: createMockFetch({
        "/libs/search": () =>
          new Response(JSON.stringify([
            { id: "/facebook/react", name: "React", description: "UI library", totalSnippets: 100 },
            { id: "/vuejs/core", name: "Vue", description: "Progressive framework", totalSnippets: 80 },
          ]), { status: 200 }),
      }) as any,
    });

    const results = await backend.search("/", "react");
    expect(results).toHaveLength(2);
    expect((results[0] as any).id).toBe("/facebook/react");
    expect((results[0] as any).name).toBe("React");
    expect((results[0] as any).snippets).toBe(100);
  });

  it("read /{owner}/{repo} should query overview docs", async () => {
    const backend = new Context7Backend({
      fetchFn: createMockFetch({
        "/context": () => new Response("React is a JavaScript library for building user interfaces.", { status: 200 }),
      }) as any,
    });

    const result = (await backend.read("/facebook/react")) as any;
    expect(result.libraryId).toBe("/facebook/react");
    expect(result.docs).toContain("React");
  });

  it("search /{owner}/{repo} should query specific docs", async () => {
    const backend = new Context7Backend({
      fetchFn: createMockFetch({
        "/context": (url) => {
          expect(url).toContain("query=useState");
          return new Response("useState is a Hook that lets you add state...", { status: 200 });
        },
      }) as any,
    });

    const results = await backend.search("/facebook/react", "useState");
    expect(results).toHaveLength(1);
    expect((results[0] as any).libraryId).toBe("/facebook/react");
    expect((results[0] as any).docs).toContain("useState");
  });

  it("read / should return usage hint", async () => {
    const backend = new Context7Backend({ fetchFn: (() => {}) as any });
    const result = (await backend.read("/")) as any;
    expect(result.usage).toBeTruthy();
  });

  it("write should throw read-only error", async () => {
    const backend = new Context7Backend({ fetchFn: (() => {}) as any });
    await expect(backend.write("/test", {})).rejects.toThrow("read-only");
  });

  it("remove should throw read-only error", async () => {
    const backend = new Context7Backend({ fetchFn: (() => {}) as any });
    await expect(backend.remove("/test")).rejects.toThrow("read-only");
  });

  it("search with single-segment path should return empty", async () => {
    const backend = new Context7Backend({ fetchFn: (() => {}) as any });
    const results = await backend.search("/react", "hooks");
    expect(results).toEqual([]);
  });
});
