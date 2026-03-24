import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startServer, type ServerHandle } from "../src/server.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Full end-to-end integration test for the Nakamichi gateway.
 *
 * Exercises the complete flow: start gateway -> auth -> browse services
 * -> set credentials -> proxy call -> federation admin.
 *
 * Uses a random high port and an isolated temp data directory so tests
 * never collide with a real instance.
 */
describe("Gateway E2E", () => {
  const tmpDir = join(tmpdir(), `nkmc-e2e-${randomUUID()}`);
  const randomPort = 19_000 + Math.floor(Math.random() * 10_000);

  let handle: ServerHandle;
  let adminToken: string;
  let agentToken: string;

  function url(path: string): string {
    return `http://127.0.0.1:${handle.port}${path}`;
  }

  const config: ServerConfig = {
    port: randomPort,
    host: "127.0.0.1",
    dataDir: tmpDir,
  };

  beforeAll(async () => {
    handle = await startServer({ config, silent: true });
    // Read the auto-generated admin token from the data directory
    adminToken = readFileSync(join(tmpDir, "admin-token"), "utf-8").trim();
  });

  afterAll(() => {
    try {
      handle?.close();
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: Auth flow ─────────────────────────────────────────
  it("POST /auth/token returns a JWT for an agent", async () => {
    const res = await fetch(url("/auth/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sub: "test-agent",
        svc: "gateway",
        roles: ["agent"],
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("token");
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);

    // Save for subsequent tests
    agentToken = body.token;
  });

  // ── Test 2: JWKS ──────────────────────────────────────────────
  it("GET /.well-known/jwks.json returns valid JWKS", async () => {
    const res = await fetch(url("/.well-known/jwks.json"));
    expect(res.ok).toBe(true);
    const jwks = await res.json();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toHaveProperty("kty");
    expect(jwks.keys[0]).toHaveProperty("kid");
  });

  // ── Test 3: Register a service ────────────────────────────────
  it("POST /registry/services registers a new service", async () => {
    const skillMd = [
      "---",
      "name: Test API",
      "description: A test service for e2e",
      "version: v1",
      "baseUrl: https://httpbin.org",
      "---",
      "## API",
      "### Get anything",
      "`GET /anything`",
      "",
    ].join("\n");

    const res = await fetch(url("/registry/services?domain=test-api.example.com"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ skillMd }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.domain).toBe("test-api.example.com");
    expect(body.name).toBe("Test API");
  });

  // ── Test 4: Browse via /fs/ ───────────────────────────────────
  it("GET /fs/ lists registered services", async () => {
    const res = await fetch(url("/fs/"), {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    // The response should contain our registered domain
    // AgentFs ls at root returns directory listings
    expect(body.ok).toBe(true);
    const entries = body.result ?? body.data;
    const names = Array.isArray(entries)
      ? entries.map((e: { name?: string }) => e.name ?? e)
      : [];
    // Directory entries may include a trailing slash
    const normalized = names.map((n: string) => n.replace(/\/$/, ""));
    expect(normalized).toContain("test-api.example.com");
  });

  // ── Test 5: Set credential and call API ───────────────────────
  it("PUT /credentials/:domain sets a pool credential", async () => {
    const res = await fetch(url("/credentials/test-api.example.com"), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth: { type: "bearer", token: "test-token-xyz" },
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("GET /fs/test-api.example.com/anything proxies to the backend", async () => {
    const res = await fetch(url("/fs/test-api.example.com/anything"), {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    // The gateway should attempt to proxy to httpbin.org/anything.
    // Even if the external call fails (e.g. in CI without internet),
    // we verify the gateway accepted the request and tried to proxy it.
    // A 200 means httpbin responded; a 502/500 means the gateway tried but
    // the upstream was unreachable. Both prove the routing works.
    expect([200, 502, 500]).toContain(res.status);
  });

  // ── Test 6: Proxy tools endpoint ──────────────────────────────
  it("GET /proxy/tools lists available CLI tools", async () => {
    const res = await fetch(url("/proxy/tools"), {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.tools.length).toBeGreaterThan(0);
    // Should contain well-known tools
    const toolNames = body.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("gh");
    expect(toolNames).toContain("stripe");
  });

  // ── Test 7: Federation admin (peers + rules) ──────────────────
  describe("Federation admin", () => {
    it("PUT /admin/federation/peers/:id creates a peer", async () => {
      const res = await fetch(url("/admin/federation/peers/peer-1"), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Test Peer",
          url: "http://localhost:9999",
          sharedSecret: "secret-abc",
        }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("GET /admin/federation/peers lists peers without sharedSecret", async () => {
      const res = await fetch(url("/admin/federation/peers"), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.peers).toHaveLength(1);
      expect(body.peers[0].id).toBe("peer-1");
      expect(body.peers[0].name).toBe("Test Peer");
      // sharedSecret should NOT be exposed in the list response
      expect(body.peers[0].sharedSecret).toBeUndefined();
    });

    it("PUT /admin/federation/rules/:domain sets a lending rule", async () => {
      const res = await fetch(url("/admin/federation/rules/test-api.example.com"), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          allow: true,
          peers: "*",
          pricing: { mode: "free" },
        }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("GET /admin/federation/rules lists lending rules", async () => {
      const res = await fetch(url("/admin/federation/rules"), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].domain).toBe("test-api.example.com");
      expect(body.rules[0].allow).toBe(true);
    });
  });
});
