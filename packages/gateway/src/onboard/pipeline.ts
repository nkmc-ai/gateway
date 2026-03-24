import type { HttpAuth } from "@nkmc/agent-fs";
import { AgentFs } from "@nkmc/agent-fs";
import type { RegistryStore } from "../registry/types.js";
import type { CredentialVault } from "../credential/types.js";
import { compileOpenApiSpec, fetchAndCompile } from "../registry/openapi-compiler.js";
import { parseSkillMd } from "../registry/skill-parser.js";
import { compileRpcDef } from "../registry/rpc-compiler.js";
import { createRegistryResolver } from "../registry/resolver.js";
import type { ManifestEntry, ManifestAuth, OnboardResult, OnboardReport } from "./types.js";

export interface PipelineOptions {
  store: RegistryStore;
  vault?: CredentialVault;
  /** Run smoke tests after registration (default true) */
  smokeTest?: boolean;
  /** Concurrency limit for parallel onboarding (default 5) */
  concurrency?: number;
  /** Custom fetch function */
  fetchFn?: typeof globalThis.fetch;
  /** Progress callback */
  onProgress?: (result: OnboardResult, index: number, total: number) => void;
}

export class OnboardPipeline {
  private store: RegistryStore;
  private vault?: CredentialVault;
  private smokeTest: boolean;
  private concurrency: number;
  private fetchFn: typeof globalThis.fetch;
  private onProgress?: PipelineOptions["onProgress"];

  constructor(options: PipelineOptions) {
    this.store = options.store;
    this.vault = options.vault;
    this.smokeTest = options.smokeTest !== false;
    this.concurrency = options.concurrency ?? 5;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.onProgress = options.onProgress;
  }

  /** Onboard a single service */
  async onboardOne(entry: ManifestEntry): Promise<OnboardResult> {
    const start = Date.now();
    const base: Omit<OnboardResult, "status" | "durationMs"> = {
      domain: entry.domain,
      source: "none",
      endpoints: 0,
      resources: 0,
      hasCredentials: false,
    };

    if (entry.disabled) {
      return { ...base, status: "skipped", durationMs: Date.now() - start };
    }

    try {
      // Step 1: Compile/parse the service definition
      if (entry.specUrl) {
        const result = await fetchAndCompile(entry.specUrl, { domain: entry.domain }, this.fetchFn);
        await this.store.put(entry.domain, result.record);
        base.source = "openapi";
        base.endpoints = result.record.endpoints.length;
        base.resources = result.resources.length;
      } else if (entry.skillMdUrl) {
        const resp = await this.fetchFn(entry.skillMdUrl);
        if (!resp.ok) throw new Error(`Failed to fetch skill.md: ${resp.status}`);
        const md = await resp.text();
        const record = parseSkillMd(entry.domain, md);
        await this.store.put(entry.domain, record);
        base.source = "wellknown";
        base.endpoints = record.endpoints.length;
      } else if (entry.skillMd) {
        const record = parseSkillMd(entry.domain, entry.skillMd);
        await this.store.put(entry.domain, record);
        base.source = "skillmd";
        base.endpoints = record.endpoints.length;
      } else if (entry.rpcDef) {
        const { record } = compileRpcDef(entry.domain, entry.rpcDef);
        await this.store.put(entry.domain, record);
        base.source = "jsonrpc";
        base.endpoints = record.endpoints.length;
        base.resources = record.source?.rpc?.resources.length ?? 0;
      } else {
        return { ...base, status: "skipped", error: "No spec, skillMdUrl, or skillMd provided", durationMs: Date.now() - start };
      }

      // Step 2: Store credentials if provided
      if (entry.auth && this.vault) {
        const auth = resolveAuth(entry.auth);
        await this.vault.putPool(entry.domain, auth);
        base.hasCredentials = true;
      }

      // Step 3: Smoke test
      if (this.smokeTest) {
        base.smokeTest = await this.runSmokeTest(entry.domain, base.hasCredentials);
      }

      return { ...base, status: "ok", durationMs: Date.now() - start };
    } catch (err) {
      return {
        ...base,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /** Onboard many services with controlled concurrency */
  async onboardMany(entries: ManifestEntry[]): Promise<OnboardReport> {
    const start = Date.now();
    const results: OnboardResult[] = [];
    let index = 0;

    // Process in batches
    for (let i = 0; i < entries.length; i += this.concurrency) {
      const batch = entries.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(
        batch.map(async (entry) => {
          const result = await this.onboardOne(entry);
          const idx = index++;
          this.onProgress?.(result, idx, entries.length);
          return result;
        }),
      );
      results.push(...batchResults);
    }

    return {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
      durationMs: Date.now() - start,
    };
  }

  private async runSmokeTest(domain: string, hasCredentials: boolean): Promise<OnboardResult["smokeTest"]> {
    const resolverOpts = this.vault
      ? { store: this.store, vault: this.vault, wrapVirtualFiles: false }
      : { store: this.store, wrapVirtualFiles: false };

    const { onMiss, listDomains } = createRegistryResolver(resolverOpts);
    const fs = new AgentFs({ mounts: [], onMiss, listDomains });

    const test: NonNullable<OnboardResult["smokeTest"]> = { ls: false, cat: false };

    // Test ls
    const lsResult = await fs.execute(`ls /${domain}/`);
    test.ls = lsResult.ok === true;

    // Test cat — only if ls succeeded and we found something to read
    if (test.ls && lsResult.ok) {
      const entries = lsResult.data as string[];
      // Find a readable resource or endpoint
      const resource = entries.find((e) => e.endsWith("/") && !e.startsWith("_"));
      if (resource) {
        // Try to list the resource — this makes a real HTTP call
        const catResult = await fs.execute(`ls /${domain}/${resource}`);
        test.cat = catResult.ok === true;
        test.catEndpoint = `ls /${domain}/${resource}`;
      } else if (entries.includes("_api/")) {
        // Just verify _api listing works
        const apiResult = await fs.execute(`ls /${domain}/_api/`);
        test.cat = apiResult.ok === true;
        test.catEndpoint = `ls /${domain}/_api/`;
      }
    }

    return test;
  }
}

/** Resolve ${ENV_VAR} references in auth values and return HttpAuth */
function resolveAuth(auth: ManifestAuth): HttpAuth {
  const resolve = (val?: string): string | undefined => {
    if (!val) return undefined;
    const match = val.match(/^\$\{(\w+)\}$/);
    if (match) {
      const envVal = process.env[match[1]];
      if (!envVal) throw new Error(`Environment variable ${match[1]} is not set`);
      return envVal;
    }
    return val;
  };

  if (auth.type === "bearer") {
    const token = resolve(auth.token);
    if (!token) throw new Error("Bearer auth requires token");
    return { type: "bearer", token, ...(auth.prefix ? { prefix: auth.prefix } : {}) };
  }
  if (auth.type === "api-key") {
    const header = resolve(auth.header);
    const key = resolve(auth.key);
    if (!header || !key) throw new Error("API key auth requires header and key");
    return { type: "api-key", header, key };
  }
  if (auth.type === "basic") {
    const username = resolve(auth.username);
    const password = resolve(auth.password);
    if (!username || !password) throw new Error("Basic auth requires username and password");
    return { type: "basic", username, password };
  }
  if (auth.type === "oauth2") {
    const tokenUrl = resolve(auth.tokenUrl);
    const clientId = resolve(auth.clientId);
    const clientSecret = resolve(auth.clientSecret);
    if (!tokenUrl || !clientId || !clientSecret) throw new Error("OAuth2 auth requires tokenUrl, clientId, and clientSecret");
    return { type: "oauth2", tokenUrl, clientId, clientSecret, ...(auth.scope ? { scope: auth.scope } : {}) };
  }
  throw new Error(`Unknown auth type: ${auth.type}`);
}
