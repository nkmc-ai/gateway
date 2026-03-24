import { describe, it, expect } from "vitest";
import { HttpBackend } from "../src/backends/http.js";

describe("HttpBackend auth prefix", () => {
  function createBackendWithAuth(auth: any): { backend: HttpBackend; getHeaders: () => Record<string, string> } {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    // No resources/endpoints → passthrough mode, so read("/test") triggers HTTP
    const backend = new HttpBackend({
      baseUrl: "https://api.example.com",
      auth,
      fetch: mockFetch as any,
    });

    return { backend, getHeaders: () => capturedHeaders };
  }

  it("should default to 'Bearer' prefix for bearer auth", async () => {
    const { backend, getHeaders } = createBackendWithAuth({
      type: "bearer",
      token: "test-token",
    });

    await backend.read("/test");
    expect(getHeaders()["Authorization"]).toBe("Bearer test-token");
  });

  it("should use custom 'Bot' prefix for Discord-style auth", async () => {
    const { backend, getHeaders } = createBackendWithAuth({
      type: "bearer",
      token: "discord-bot-token",
      prefix: "Bot",
    });

    await backend.read("/test");
    expect(getHeaders()["Authorization"]).toBe("Bot discord-bot-token");
  });

  it("should use custom 'Token' prefix", async () => {
    const { backend, getHeaders } = createBackendWithAuth({
      type: "bearer",
      token: "my-token",
      prefix: "Token",
    });

    await backend.read("/test");
    expect(getHeaders()["Authorization"]).toBe("Token my-token");
  });

  it("should not affect api-key auth", async () => {
    const { backend, getHeaders } = createBackendWithAuth({
      type: "api-key",
      header: "X-API-Key",
      key: "secret-key",
    });

    await backend.read("/test");
    expect(getHeaders()["X-API-Key"]).toBe("secret-key");
    expect(getHeaders()["Authorization"]).toBeUndefined();
  });

  it("should not affect basic auth", async () => {
    const { backend, getHeaders } = createBackendWithAuth({
      type: "basic",
      username: "user",
      password: "pass",
    });

    await backend.read("/test");
    expect(getHeaders()["Authorization"]).toBe(`Basic ${btoa("user:pass")}`);
  });
});
