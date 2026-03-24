import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCredentialVault } from "../../src/credential/memory-vault.js";

describe("MemoryCredentialVault", () => {
  let vault: MemoryCredentialVault;

  beforeEach(() => {
    vault = new MemoryCredentialVault();
  });

  it("should store and retrieve pool credential", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "tok_123" });
    const cred = await vault.get("api.example.com");
    expect(cred).not.toBeNull();
    expect(cred!.auth).toEqual({ type: "bearer", token: "tok_123" });
    expect(cred!.scope).toBe("pool");
  });

  it("should return null for unknown domain", async () => {
    const cred = await vault.get("unknown.com");
    expect(cred).toBeNull();
  });

  it("should prefer BYOK over pool", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "pool_tok" });
    await vault.putByok("api.example.com", "dev-1", { type: "bearer", token: "byok_tok" });
    const cred = await vault.get("api.example.com", "dev-1");
    expect(cred!.auth).toEqual({ type: "bearer", token: "byok_tok" });
    expect(cred!.scope).toBe("byok");
  });

  it("should fall back to pool when no BYOK for developer", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "pool_tok" });
    const cred = await vault.get("api.example.com", "dev-2");
    expect(cred!.auth).toEqual({ type: "bearer", token: "pool_tok" });
  });

  it("should delete pool credential", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "tok" });
    await vault.delete("api.example.com");
    expect(await vault.get("api.example.com")).toBeNull();
  });

  it("should delete BYOK credential", async () => {
    await vault.putByok("api.example.com", "dev-1", { type: "bearer", token: "tok" });
    await vault.delete("api.example.com", "dev-1");
    expect(await vault.get("api.example.com", "dev-1")).toBeNull();
  });

  it("should list domains", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "t1" });
    await vault.putPool("other.api.com", { type: "bearer", token: "t2" });
    const domains = await vault.listDomains();
    expect(domains).toContain("api.example.com");
    expect(domains).toContain("other.api.com");
  });

  it("should support api-key auth type", async () => {
    await vault.putPool("cf.com", { type: "api-key", header: "X-Auth-Key", key: "abc" });
    const cred = await vault.get("cf.com");
    expect(cred!.auth).toEqual({ type: "api-key", header: "X-Auth-Key", key: "abc" });
  });
});
