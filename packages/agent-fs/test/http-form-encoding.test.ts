import { describe, it, expect } from "vitest";
import { HttpBackend, encodeFormBody } from "../src/backends/http.js";

// --- encodeFormBody unit tests ---

describe("encodeFormBody", () => {
  it("should encode flat key-value pairs", () => {
    const result = encodeFormBody({ name: "Alice", age: "30" });
    expect(result).toBe("name=Alice&age=30");
  });

  it("should encode nested objects with bracket notation", () => {
    const result = encodeFormBody({ metadata: { key: "value", foo: "bar" } });
    expect(result).toContain("metadata%5Bkey%5D=value");
    expect(result).toContain("metadata%5Bfoo%5D=bar");
  });

  it("should encode arrays with [] suffix", () => {
    const result = encodeFormBody({ items: ["a", "b", "c"] });
    expect(result).toBe("items%5B%5D=a&items%5B%5D=b&items%5B%5D=c");
  });

  it("should URL-encode special characters", () => {
    const result = encodeFormBody({ q: "hello world&more=yes" });
    expect(result).toBe("q=hello%20world%26more%3Dyes");
  });

  it("should handle empty object", () => {
    expect(encodeFormBody({})).toBe("");
  });

  it("should handle null and undefined", () => {
    expect(encodeFormBody(null)).toBe("");
    expect(encodeFormBody(undefined)).toBe("");
  });

  it("should skip undefined values", () => {
    const result = encodeFormBody({ a: "1", b: undefined, c: "3" });
    expect(result).toBe("a=1&c=3");
  });

  it("should handle deeply nested objects", () => {
    const result = encodeFormBody({
      card: { address: { city: "Tokyo" } },
    });
    expect(result).toBe("card%5Baddress%5D%5Bcity%5D=Tokyo");
  });
});

// --- HttpBackend bodyEncoding integration tests ---

describe("HttpBackend bodyEncoding", () => {
  it("should send Content-Type: application/json by default", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const mockFetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    };

    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      fetch: mockFetch as any,
    });

    await backend.write("/", { name: "test" });
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(capturedBody).toBe(JSON.stringify({ name: "test" }));
  });

  it("should send Content-Type: application/x-www-form-urlencoded when bodyEncoding=form", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const mockFetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ id: "cus_123" }), { status: 200 });
    };

    const backend = new HttpBackend({
      baseUrl: "https://api.stripe.com/v1",
      bodyEncoding: "form",
      fetch: mockFetch as any,
    });

    await backend.write("/", { name: "Alice", email: "alice@example.com" });
    expect(capturedHeaders["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(capturedBody).toBe("name=Alice&email=alice%40example.com");
  });

  it("should encode nested objects in form mode", async () => {
    let capturedBody = "";

    const mockFetch = async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ id: "sub_1" }), { status: 200 });
    };

    const backend = new HttpBackend({
      baseUrl: "https://api.stripe.com/v1",
      bodyEncoding: "form",
      fetch: mockFetch as any,
    });

    await backend.write("/", {
      customer: "cus_123",
      metadata: { order_id: "42" },
    });
    expect(capturedBody).toContain("customer=cus_123");
    expect(capturedBody).toContain("metadata%5Border_id%5D=42");
  });
});
