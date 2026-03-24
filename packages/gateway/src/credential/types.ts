import type { HttpAuth } from "@nkmc/agent-fs";

export interface StoredCredential {
  domain: string;
  auth: HttpAuth;
  scope: "pool" | "byok";
  developerId?: string;
}

export interface CredentialVault {
  get(domain: string, developerId?: string): Promise<StoredCredential | null>;
  putPool(domain: string, auth: HttpAuth): Promise<void>;
  putByok(domain: string, developerId: string, auth: HttpAuth): Promise<void>;
  delete(domain: string, developerId?: string): Promise<void>;
  listDomains(): Promise<string[]>;
}
