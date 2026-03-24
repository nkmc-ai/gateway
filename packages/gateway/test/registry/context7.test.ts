import { describe, it, expect } from "vitest";
import { Context7Client } from "../../src/registry/context7.js";

describe("Context7Client", () => {
  it("should search libraries successfully", async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain("/libs/search");
      expect(url).toContain("libraryName=react");
      return new Response(JSON.stringify([{ id: "/facebook/react", name: "React" }]), { status: 200 });
    };
    const client = new Context7Client({ fetchFn: mockFetch as any });
    const results = await client.searchLibraries("react");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("/facebook/react");
  });

  it("should query docs successfully", async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain("/context");
      expect(url).toContain("libraryId=");
      expect(url).toContain("query=hooks");
      return new Response("React hooks documentation...", { status: 200 });
    };
    const client = new Context7Client({ fetchFn: mockFetch as any });
    const result = await client.queryDocs("/facebook/react", "hooks");
    expect(result).toContain("React hooks");
  });

  it("should throw on failed query", async () => {
    const mockFetch = async () => new Response("error", { status: 500 });
    const client = new Context7Client({ fetchFn: mockFetch as any });
    await expect(client.queryDocs("/bad/lib", "test")).rejects.toThrow("Context7 query failed");
  });

  it("should throw on failed search", async () => {
    const mockFetch = async () => new Response("error", { status: 403 });
    const client = new Context7Client({ fetchFn: mockFetch as any });
    await expect(client.searchLibraries("test")).rejects.toThrow("Context7 search failed");
  });

  it("should use custom baseUrl", async () => {
    let requestedUrl = "";
    const mockFetch = async (url: string) => {
      requestedUrl = url;
      return new Response("ok", { status: 200 });
    };
    const client = new Context7Client({ baseUrl: "https://custom.api.com", fetchFn: mockFetch as any });
    await client.queryDocs("/lib/id", "test");
    expect(requestedUrl).toContain("https://custom.api.com");
  });

  it("should send auth header when apiKey is set", async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch = async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    };
    const client = new Context7Client({ apiKey: "ctx7sk_test123", fetchFn: mockFetch as any });
    await client.queryDocs("/lib/id", "test");
    expect(capturedHeaders["Authorization"]).toBe("Bearer ctx7sk_test123");
  });

  it("should not send auth header when apiKey is not set", async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch = async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    };
    const client = new Context7Client({ fetchFn: mockFetch as any });
    await client.queryDocs("/lib/id", "test");
    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });
});
