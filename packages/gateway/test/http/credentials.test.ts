import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { credentialRoutes } from "../../src/http/routes/credentials.js";
import { MemoryCredentialVault } from "../../src/credential/memory-vault.js";

describe("Credential Routes", () => {
  let vault: MemoryCredentialVault;
  let app: Hono;

  beforeEach(() => {
    vault = new MemoryCredentialVault();
    app = new Hono();
    app.route("/credentials", credentialRoutes({ vault }));
  });

  it("should set pool credential via PUT", async () => {
    const res = await app.request("/credentials/api.example.com", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: { type: "bearer", token: "tok_123" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);

    const cred = await vault.get("api.example.com");
    expect(cred!.auth).toEqual({ type: "bearer", token: "tok_123" });
  });

  it("should list domains with credentials", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "tok" });
    await vault.putPool("other.com", { type: "bearer", token: "tok2" });

    const res = await app.request("/credentials");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.domains).toContain("api.example.com");
    expect(body.domains).toContain("other.com");
  });

  it("should delete credential", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "tok" });
    const res = await app.request("/credentials/api.example.com", { method: "DELETE" });
    expect(res.status).toBe(200);

    expect(await vault.get("api.example.com")).toBeNull();
  });

  it("should reject missing auth.type", async () => {
    const res = await app.request("/credentials/api.example.com", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: {} }),
    });
    expect(res.status).toBe(400);
  });
});
