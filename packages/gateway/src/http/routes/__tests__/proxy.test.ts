import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { MemoryCredentialVault } from "../../../credential/memory-vault.js";
import {
  ToolRegistry,
  createDefaultToolRegistry,
} from "../../../proxy/tool-registry.js";
import { proxyRoutes, type ExecResult } from "../proxy.js";

/**
 * Helper: create a test app with agent middleware stubbed out
 * so we can test the proxy routes in isolation.
 */
function createTestApp(options?: {
  vault?: MemoryCredentialVault;
  toolRegistry?: ToolRegistry;
  exec?: (tool: string, args: string[], env: Record<string, string>) => Promise<ExecResult>;
}) {
  const vault = options?.vault ?? new MemoryCredentialVault();
  const toolRegistry = options?.toolRegistry ?? createDefaultToolRegistry();
  const exec = options?.exec ?? vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  type Env = {
    Variables: {
      agent: { id: string; roles: string[] };
    };
  };

  const app = new Hono<Env>();

  // Stub agent auth — always set a fixed agent identity
  app.use("*", async (c, next) => {
    c.set("agent", { id: "agent-1", roles: ["read"] });
    await next();
  });

  app.route("/", proxyRoutes({ vault, toolRegistry, exec }));

  return { app, vault, toolRegistry, exec };
}

describe("proxy routes", () => {
  describe("POST /exec", () => {
    it("executes a tool with valid credential and returns stdout", async () => {
      const vault = new MemoryCredentialVault();
      await vault.putPool("github.com", { type: "bearer", token: "ghp_test123" });

      const exec = vi.fn(async (_tool: string, _args: string[], _env: Record<string, string>) => ({
        stdout: "Hello from gh\n",
        stderr: "",
        exitCode: 0,
      }));

      const { app } = createTestApp({ vault, exec });

      const res = await app.request("/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "gh", args: ["auth", "status"] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        stdout: "Hello from gh\n",
        stderr: "",
        exitCode: 0,
      });

      // Verify exec was called with correct env injection
      expect(exec).toHaveBeenCalledWith(
        "gh",
        ["auth", "status"],
        { GH_TOKEN: "ghp_test123" },
      );
    });

    it("returns 404 for an unknown tool", async () => {
      const { app } = createTestApp();

      const res = await app.request("/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "nonexistent", args: [] }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Unknown tool");
    });

    it("returns 401 when no credential is available", async () => {
      // Vault is empty — no credential for github.com
      const vault = new MemoryCredentialVault();
      const { app } = createTestApp({ vault });

      const res = await app.request("/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "gh", args: ["pr", "list"] }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("No credential");
    });

    it("returns 400 when tool field is missing", async () => {
      const { app } = createTestApp();

      const res = await app.request("/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["foo"] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Missing 'tool' field");
    });

    it("defaults args to empty array when not provided", async () => {
      const vault = new MemoryCredentialVault();
      await vault.putPool("github.com", { type: "bearer", token: "ghp_x" });

      const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
      const { app } = createTestApp({ vault, exec });

      const res = await app.request("/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "gh" }),
      });

      expect(res.status).toBe(200);
      expect(exec).toHaveBeenCalledWith("gh", [], { GH_TOKEN: "ghp_x" });
    });
  });

  describe("GET /tools", () => {
    it("returns the list of available tools", async () => {
      const { app } = createTestApp();

      const res = await app.request("/tools", { method: "GET" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toBeInstanceOf(Array);
      expect(body.tools.length).toBe(5);

      const names = body.tools.map((t: { name: string }) => t.name).sort();
      expect(names).toEqual(["anthropic", "aws", "gh", "openai", "stripe"]);

      // Each tool should expose name and credentialDomain only
      const gh = body.tools.find((t: { name: string }) => t.name === "gh");
      expect(gh).toEqual({ name: "gh", credentialDomain: "github.com" });
    });
  });
});
