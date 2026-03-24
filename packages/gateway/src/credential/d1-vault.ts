import type { D1Database } from "../d1/types.js";
import type { HttpAuth } from "@nkmc/agent-fs";
import type { CredentialVault, StoredCredential } from "./types.js";

const CREATE_CREDENTIALS = `
CREATE TABLE IF NOT EXISTS credentials (
  domain TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'pool',
  developer_id TEXT NOT NULL DEFAULT '',
  auth_encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (domain, scope, developer_id)
)`;

interface CredentialRow {
  domain: string;
  scope: string;
  developer_id: string;
  auth_encrypted: string;
  created_at: number;
  updated_at: number;
}

async function encrypt(auth: HttpAuth, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(auth));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encoded: string, key: CryptoKey): Promise<HttpAuth> {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    // Fallback: legacy base64-encoded JSON (pre-encryption data)
    return JSON.parse(atob(encoded));
  }
}

export class D1CredentialVault implements CredentialVault {
  constructor(
    private db: D1Database,
    private encryptionKey: CryptoKey,
  ) {}

  async initSchema(): Promise<void> {
    await this.db.exec(CREATE_CREDENTIALS);
  }

  async get(domain: string, developerId?: string): Promise<StoredCredential | null> {
    // BYOK first
    if (developerId) {
      const byok = await this.db
        .prepare("SELECT * FROM credentials WHERE domain = ? AND scope = 'byok' AND developer_id = ?")
        .bind(domain, developerId)
        .first<CredentialRow>();
      if (byok) return await this.rowToCredential(byok);
    }
    // Pool fallback
    const pool = await this.db
      .prepare("SELECT * FROM credentials WHERE domain = ? AND scope = 'pool' AND developer_id = ''")
      .bind(domain)
      .first<CredentialRow>();
    return pool ? await this.rowToCredential(pool) : null;
  }

  async putPool(domain: string, auth: HttpAuth): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO credentials (domain, scope, developer_id, auth_encrypted, created_at, updated_at)
         VALUES (?, 'pool', '', ?, ?, ?)`,
      )
      .bind(domain, await encrypt(auth, this.encryptionKey), now, now)
      .run();
  }

  async putByok(domain: string, developerId: string, auth: HttpAuth): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO credentials (domain, scope, developer_id, auth_encrypted, created_at, updated_at)
         VALUES (?, 'byok', ?, ?, ?, ?)`,
      )
      .bind(domain, developerId, await encrypt(auth, this.encryptionKey), now, now)
      .run();
  }

  async delete(domain: string, developerId?: string): Promise<void> {
    if (developerId) {
      await this.db
        .prepare("DELETE FROM credentials WHERE domain = ? AND scope = 'byok' AND developer_id = ?")
        .bind(domain, developerId)
        .run();
    } else {
      await this.db
        .prepare("DELETE FROM credentials WHERE domain = ? AND scope = 'pool' AND developer_id = ''")
        .bind(domain)
        .run();
    }
  }

  async listDomains(): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT DISTINCT domain FROM credentials")
      .all<{ domain: string }>();
    return results.map((r) => r.domain);
  }

  private async rowToCredential(row: CredentialRow): Promise<StoredCredential> {
    return {
      domain: row.domain,
      auth: await decrypt(row.auth_encrypted, this.encryptionKey),
      scope: row.scope as "pool" | "byok",
      ...(row.developer_id ? { developerId: row.developer_id } : {}),
    };
  }
}
