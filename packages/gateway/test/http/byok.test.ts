import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { byokRoutes } from "../../src/http/routes/byok.js";
import { MemoryCredentialVault } from "../../src/credential/memory-vault.js";

type Env = {
  Variables: {
    agent: { id: string; roles: string[] };
  };
};

describe("BYOK Routes", () => {
  let vault: MemoryCredentialVault;
  let app: Hono<Env>;
  const agentId = "agent-test-1";

  beforeEach(() => {
    vault = new MemoryCredentialVault();
    app = new Hono<Env>();
    // Simulate agentAuth middleware — inject agent context
    app.use("/*", async (c, next) => {
      c.set("agent", { id: agentId, roles: ["agent"] });
      await next();
    });
    app.route("/byok", byokRoutes({ vault }));
  });

  it("should upload BYOK credential via PUT", async () => {
    const res = await app.request("/byok/api.openai.com", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: { type: "bearer", token: "sk-test-123" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);

    // Verify credential is stored as BYOK for this agent
    const cred = await vault.get("api.openai.com", agentId);
    expect(cred).not.toBeNull();
    expect(cred!.scope).toBe("byok");
    expect(cred!.developerId).toBe(agentId);
    expect(cred!.auth).toEqual({ type: "bearer", token: "sk-test-123" });
  });

  it("should list only this agent's BYOK domains", async () => {
    // Agent's BYOK
    await vault.putByok("api.openai.com", agentId, {
      type: "bearer",
      token: "sk-1",
    });
    // Another agent's BYOK
    await vault.putByok("api.github.com", "agent-other", {
      type: "bearer",
      token: "ghp-1",
    });
    // Pool credential (should not appear)
    await vault.putPool("api.stripe.com", {
      type: "bearer",
      token: "sk_pool",
    });

    const res = await app.request("/byok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.domains).toContain("api.openai.com");
    expect(body.domains).not.toContain("api.github.com");
    expect(body.domains).not.toContain("api.stripe.com");
  });

  it("should delete agent's BYOK credential", async () => {
    await vault.putByok("api.openai.com", agentId, {
      type: "bearer",
      token: "sk-1",
    });

    const res = await app.request("/byok/api.openai.com", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // BYOK should be gone
    const cred = await vault.get("api.openai.com", agentId);
    // Should fall back to pool (which doesn't exist), so null
    expect(cred).toBeNull();
  });

  it("should reject missing auth.type", async () => {
    const res = await app.request("/byok/api.openai.com", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("BYOK should take priority over pool in vault.get()", async () => {
    await vault.putPool("api.openai.com", {
      type: "bearer",
      token: "pool-token",
    });
    await vault.putByok("api.openai.com", agentId, {
      type: "bearer",
      token: "byok-token",
    });

    // With developerId → BYOK
    const byok = await vault.get("api.openai.com", agentId);
    expect(byok!.auth).toEqual({ type: "bearer", token: "byok-token" });

    // Without developerId → pool
    const pool = await vault.get("api.openai.com");
    expect(pool!.auth).toEqual({ type: "bearer", token: "pool-token" });
  });
});
