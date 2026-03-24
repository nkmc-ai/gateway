import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startServer, type ServerHandle } from "../src/server.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Integration tests for startServer().
 *
 * Uses a random high port and an isolated temp data directory so
 * tests never collide with a real instance.
 */
describe("startServer() integration", () => {
  const tmpDir = join(tmpdir(), `nkmc-server-test-${randomUUID()}`);
  let handle: ServerHandle;

  // Pick a random port in the ephemeral range to avoid collisions
  const randomPort = 10_000 + Math.floor(Math.random() * 50_000);

  const config: ServerConfig = {
    port: randomPort,
    host: "127.0.0.1",
    dataDir: tmpDir,
    adminToken: `test-admin-${randomUUID()}`,
  };

  // Start the server once for all tests in this suite
  // We use a manual setup instead of beforeAll because startServer is async
  // and we need to ensure sequential test execution anyway.
  let startPromise: Promise<void> | undefined;

  function ensureStarted(): Promise<void> {
    if (!startPromise) {
      startPromise = (async () => {
        mkdirSync(tmpDir, { recursive: true });
        handle = await startServer({ config, silent: true });
      })();
    }
    return startPromise;
  }

  afterAll(() => {
    try {
      handle?.close();
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseUrl(): string {
    return `http://127.0.0.1:${handle.port}`;
  }

  it("starts and exposes the correct port", async () => {
    await ensureStarted();
    expect(handle.port).toBe(randomPort);
  });

  it("GET /.well-known/jwks.json returns valid JWKS", async () => {
    await ensureStarted();
    const res = await fetch(`${baseUrl()}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("keys");
    expect(Array.isArray(json.keys)).toBe(true);
    expect(json.keys.length).toBeGreaterThan(0);
    // Each key should have standard JWK fields
    const key = json.keys[0];
    expect(key).toHaveProperty("kty");
    expect(key).toHaveProperty("kid");
  });

  it("POST /auth/token with valid body returns a token", async () => {
    await ensureStarted();
    const res = await fetch(`${baseUrl()}/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.adminToken}`,
      },
      body: JSON.stringify({ sub: "test-agent", svc: "example.com" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("token");
    expect(typeof json.token).toBe("string");
    expect(json.token.length).toBeGreaterThan(0);
  });

  it("POST /auth/token with missing fields returns 400", async () => {
    await ensureStarted();
    const res = await fetch(`${baseUrl()}/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.adminToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("close() cleanly shuts down the server", async () => {
    await ensureStarted();
    // Verify the server is responding
    const res = await fetch(`${baseUrl()}/.well-known/jwks.json`);
    expect(res.ok).toBe(true);

    // Close the server
    handle.close();

    // After closing, requests should fail
    await expect(
      fetch(`${baseUrl()}/.well-known/jwks.json`).then((r) => r.json()),
    ).rejects.toThrow();
  });
});
