import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { serve } from "@hono/node-server";
import { generateKeyPair, exportJWK } from "jose";
import { createSqliteD1, D1RegistryStore, D1CredentialVault, D1PeerStore } from "@nkmc/gateway";
import { createGateway } from "@nkmc/gateway/http";
import { createDefaultToolRegistry } from "@nkmc/gateway/proxy";
import { nanoid } from "nanoid";
import { createExec } from "./exec.js";
import { migrations } from "./migrations.js";
import type { ServerConfig } from "./config.js";

export interface StartServerOptions {
  config: ServerConfig;
  /** If true, suppress banner output */
  silent?: boolean;
}

export interface ServerHandle {
  /** The port the server is listening on */
  port: number;
  /** Close the server and database */
  close: () => void;
}

export async function startServer(options: StartServerOptions): Promise<ServerHandle> {
  const { config, silent } = options;
  const log = silent ? () => {} : console.log.bind(console);

  // Ensure data directory exists
  mkdirSync(config.dataDir, { recursive: true });

  // ── SQLite ────────────────────────────────────────────────
  const dbPath = join(config.dataDir, "nkmc.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = createSqliteD1(sqlite);

  // ── Migrations ────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _nkmc_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`);

  for (const m of migrations) {
    const applied = sqlite.prepare("SELECT 1 FROM _nkmc_migrations WHERE name = ?").get(m.name);
    if (applied) continue;
    try {
      sqlite.exec(m.sql);
      sqlite.prepare("INSERT OR IGNORE INTO _nkmc_migrations (name) VALUES (?)").run(m.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate column")) {
        sqlite.prepare("INSERT OR IGNORE INTO _nkmc_migrations (name) VALUES (?)").run(m.name);
      } else {
        throw err;
      }
    }
  }

  log("[nkmc] Migrations applied");

  // ── Gateway Key Pair (EdDSA / Ed25519) ───────────────────
  let privateKey: Record<string, unknown>;
  let publicKey: Record<string, unknown>;
  const keysPath = join(config.dataDir, "keys.json");

  if (config.gatewayPrivateKey && config.gatewayPublicKey) {
    privateKey = JSON.parse(config.gatewayPrivateKey);
    publicKey = JSON.parse(config.gatewayPublicKey);
    log("[nkmc] Loaded gateway keys from config/env");
  } else if (existsSync(keysPath)) {
    const keys = JSON.parse(readFileSync(keysPath, "utf-8"));
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;
    log("[nkmc] Loaded gateway keys from", keysPath);
  } else {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    privateKey = { ...(await exportJWK(pair.privateKey)), kty: "OKP", crv: "Ed25519" };
    publicKey = { ...(await exportJWK(pair.publicKey)), kty: "OKP", crv: "Ed25519" };
    const kid = nanoid(12);
    privateKey.kid = kid;
    publicKey.kid = kid;
    writeFileSync(keysPath, JSON.stringify({ privateKey, publicKey }, null, 2), "utf-8");
    chmodSync(keysPath, 0o600);
    log("[nkmc] Generated new gateway key pair ->", keysPath);
  }
  try { chmodSync(keysPath, 0o600); } catch {}

  // ── Encryption Key (AES-GCM) ─────────────────────────────
  const encKeyPath = join(config.dataDir, "encryption.key");
  let rawKeyB64: string;

  if (config.encryptionKey) {
    rawKeyB64 = config.encryptionKey;
    log("[nkmc] Using encryption key from config/env");
  } else if (existsSync(encKeyPath)) {
    rawKeyB64 = readFileSync(encKeyPath, "utf-8").trim();
    log("[nkmc] Loaded encryption key from", encKeyPath);
  } else {
    const buf = randomBytes(32);
    rawKeyB64 = buf.toString("base64");
    writeFileSync(encKeyPath, rawKeyB64, "utf-8");
    chmodSync(encKeyPath, 0o600);
    log("[nkmc] Generated new encryption key ->", encKeyPath);
  }
  // Ensure encryption key file is always owner-only
  try { chmodSync(encKeyPath, 0o600); } catch {}

  const rawKey = Uint8Array.from(atob(rawKeyB64), (c) => c.charCodeAt(0));
  const encryptionKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);

  // ── Admin Token ───────────────────────────────────────────
  const adminTokenPath = join(config.dataDir, "admin-token");
  let adminToken = config.adminToken;
  if (!adminToken) {
    if (existsSync(adminTokenPath)) {
      adminToken = readFileSync(adminTokenPath, "utf-8").trim();
      log("[nkmc] Loaded admin token from", adminTokenPath);
    } else {
      adminToken = randomUUID();
      writeFileSync(adminTokenPath, adminToken, "utf-8");
      chmodSync(adminTokenPath, 0o600);
      log("[nkmc] Generated admin token ->", adminTokenPath);
    }
  }
  try { chmodSync(adminTokenPath, 0o600); } catch {}

  // ── Stores ────────────────────────────────────────────────
  const store = new D1RegistryStore(db);
  const vault = new D1CredentialVault(db, encryptionKey);
  const peerStore = new D1PeerStore(db);

  // ── Create Gateway ────────────────────────────────────────
  const toolRegistry = createDefaultToolRegistry();
  const exec = createExec();

  const gateway = createGateway({
    store,
    vault,
    db,
    gatewayPrivateKey: privateKey,
    gatewayPublicKey: publicKey,
    adminToken,
    peerStore,
    proxy: { toolRegistry, exec },
  });

  // ── Start Server ──────────────────────────────────────────
  return new Promise<ServerHandle>((resolve) => {
    const server = serve(
      {
        fetch: gateway.fetch,
        port: config.port,
        hostname: config.host,
      },
      (info) => {
        log();
        log("  ┌──────────────────────────────────────────┐");
        log("  │  nakamichi gateway (standalone)           │");
        log("  └──────────────────────────────────────────┘");
        log();
        log(`  Port:     ${info.port}`);
        log(`  Host:     ${config.host}`);
        log(`  Data dir: ${config.dataDir}`);
        log(`  Database: ${dbPath}`);
        log();

        resolve({
          port: info.port,
          close: () => {
            server.close();
            sqlite.close();
          },
        });
      },
    );
  });
}
