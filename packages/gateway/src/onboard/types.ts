import type { HttpAuth } from "@nkmc/agent-fs";

export interface RpcManifestDef {
  url: string;
  convention?: "crud" | "evm" | "raw";
  methods: Array<{
    rpcMethod: string;
    description: string;
    resource?: string;
    fsOp?: "list" | "read" | "write" | "create" | "remove" | "search";
  }>;
}

/** A single service to onboard */
export interface ManifestEntry {
  domain: string;
  /** OpenAPI spec URL — triggers compilation */
  specUrl?: string;
  /** skill.md URL — fetched and registered directly */
  skillMdUrl?: string;
  /** Inline skill.md content */
  skillMd?: string;
  /** JSON-RPC definition — triggers RPC compilation */
  rpcDef?: RpcManifestDef;
  /** Pool credential — values can be "${ENV_VAR}" references */
  auth?: ManifestAuth;
  /** Tags for categorization */
  tags?: string[];
  /** Skip this entry (default false) */
  disabled?: boolean;
}

export interface ManifestAuth {
  type: "bearer" | "api-key" | "basic" | "oauth2";
  token?: string;
  prefix?: string;
  header?: string;
  key?: string;
  username?: string;
  password?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

/** Result of onboarding one service */
export interface OnboardResult {
  domain: string;
  status: "ok" | "failed" | "skipped";
  error?: string;
  source: "openapi" | "skillmd" | "wellknown" | "jsonrpc" | "none";
  endpoints: number;
  resources: number;
  hasCredentials: boolean;
  smokeTest?: {
    ls: boolean;
    cat: boolean;
    catEndpoint?: string;
  };
  durationMs: number;
}

/** Summary of a batch onboard run */
export interface OnboardReport {
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  results: OnboardResult[];
  durationMs: number;
}
