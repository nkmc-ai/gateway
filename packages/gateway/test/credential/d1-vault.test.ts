import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { D1CredentialVault } from "../../src/credential/d1-vault.js";
import { SqliteD1 } from "../../src/testing/sqlite-d1.js";

describe("D1CredentialVault", () => {
  let db: SqliteD1;
  let vault: D1CredentialVault;
  let key: CryptoKey;

  beforeEach(async () => {
    db = new SqliteD1();
    key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    vault = new D1CredentialVault(db, key);
    await vault.initSchema();
  });

  afterEach(() => {
    db.close();
  });

  it("should store and retrieve pool credential", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "tok_123" });
    const cred = await vault.get("api.example.com");
    expect(cred).not.toBeNull();
    expect(cred!.auth).toEqual({ type: "bearer", token: "tok_123" });
    expect(cred!.scope).toBe("pool");
  });

  it("should return null for unknown domain", async () => {
    expect(await vault.get("unknown.com")).toBeNull();
  });

  it("should prefer BYOK over pool", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "pool_tok" });
    await vault.putByok("api.example.com", "dev-1", { type: "bearer", token: "byok_tok" });
    const cred = await vault.get("api.example.com", "dev-1");
    expect(cred!.auth).toEqual({ type: "bearer", token: "byok_tok" });
  });

  it("should fall back to pool when no BYOK", async () => {
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

  it("should call initSchema multiple times (idempotent)", async () => {
    await vault.initSchema();
    await vault.putPool("test.com", { type: "bearer", token: "x" });
    expect(await vault.get("test.com")).not.toBeNull();
  });

  it("should decrypt legacy base64-encoded credentials", async () => {
    // Simulate legacy data: plain base64(JSON) without AES-GCM encryption
    const legacyAuth = { type: "bearer", token: "legacy_tok" };
    const legacyEncoded = btoa(JSON.stringify(legacyAuth));
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO credentials (domain, scope, developer_id, auth_encrypted, created_at, updated_at)
         VALUES (?, 'pool', '', ?, ?, ?)`,
      )
      .bind("legacy.example.com", legacyEncoded, now, now)
      .run();

    const cred = await vault.get("legacy.example.com");
    expect(cred).not.toBeNull();
    expect(cred!.auth).toEqual({ type: "bearer", token: "legacy_tok" });
  });

  it("should produce different ciphertext for same input (random IV)", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "tok" });
    // Read raw encrypted value
    const row1 = await db
      .prepare("SELECT auth_encrypted FROM credentials WHERE domain = ?")
      .bind("api.example.com")
      .first<{ auth_encrypted: string }>();

    // Re-encrypt with same data
    await vault.putPool("api.example.com", { type: "bearer", token: "tok" });
    const row2 = await db
      .prepare("SELECT auth_encrypted FROM credentials WHERE domain = ?")
      .bind("api.example.com")
      .first<{ auth_encrypted: string }>();

    // Random IV means ciphertext should differ
    expect(row1!.auth_encrypted).not.toBe(row2!.auth_encrypted);
  });

  it("should not decrypt with a different key", async () => {
    await vault.putPool("api.example.com", { type: "bearer", token: "secret" });

    // Create vault with different key
    const otherKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const otherVault = new D1CredentialVault(db, otherKey);

    // AES-GCM decrypt fails → fallback to base64 decode → JSON.parse fails → throws
    await expect(otherVault.get("api.example.com")).rejects.toThrow();
  });
});
