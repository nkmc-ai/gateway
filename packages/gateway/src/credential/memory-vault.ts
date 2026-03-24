import type { HttpAuth } from "@nkmc/agent-fs";
import type { CredentialVault, StoredCredential } from "./types.js";

export class MemoryCredentialVault implements CredentialVault {
  // key = "pool:domain" or "byok:domain:developerId"
  private credentials = new Map<string, StoredCredential>();

  private poolKey(domain: string): string {
    return `pool:${domain}`;
  }

  private byokKey(domain: string, developerId: string): string {
    return `byok:${domain}:${developerId}`;
  }

  async get(domain: string, developerId?: string): Promise<StoredCredential | null> {
    // BYOK takes priority over pool
    if (developerId) {
      const byok = this.credentials.get(this.byokKey(domain, developerId));
      if (byok) return byok;
    }
    return this.credentials.get(this.poolKey(domain)) ?? null;
  }

  async putPool(domain: string, auth: HttpAuth): Promise<void> {
    this.credentials.set(this.poolKey(domain), { domain, auth, scope: "pool" });
  }

  async putByok(domain: string, developerId: string, auth: HttpAuth): Promise<void> {
    this.credentials.set(this.byokKey(domain, developerId), {
      domain, auth, scope: "byok", developerId,
    });
  }

  async delete(domain: string, developerId?: string): Promise<void> {
    if (developerId) {
      this.credentials.delete(this.byokKey(domain, developerId));
    } else {
      this.credentials.delete(this.poolKey(domain));
    }
  }

  async listDomains(): Promise<string[]> {
    const domains = new Set<string>();
    for (const cred of this.credentials.values()) {
      domains.add(cred.domain);
    }
    return Array.from(domains);
  }
}
