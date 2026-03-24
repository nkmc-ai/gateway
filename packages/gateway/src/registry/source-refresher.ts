import type { RegistryStore, ServiceRecord } from "./types.js";
import { fetchAndCompile } from "./openapi-compiler.js";

export class SourceRefresher {
  constructor(
    private store: RegistryStore,
    private fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async shouldRefresh(record: ServiceRecord): Promise<boolean> {
    if (!record.source?.refreshInterval) return false;
    const lastRefresh = record.source.lastRefresh ?? record.updatedAt;
    return Date.now() - lastRefresh > record.source.refreshInterval * 1000;
  }

  async refresh(record: ServiceRecord): Promise<ServiceRecord | null> {
    if (!record.source) return null;

    if (record.source.type === "openapi" && record.source.url) {
      const result = await fetchAndCompile(
        record.source.url,
        { domain: record.domain, version: record.version, isFirstParty: record.isFirstParty },
        this.fetchFn,
      );
      const updated: ServiceRecord = {
        ...result.record,
        createdAt: record.createdAt,
        isDefault: record.isDefault,
        source: { ...record.source, lastRefresh: Date.now() },
      };
      await this.store.put(record.domain, updated);
      return updated;
    }

    if (record.source.type === "wellknown" && record.source.url) {
      const resp = await this.fetchFn(record.source.url);
      if (!resp.ok) return null;
      const skillMd = await resp.text();
      // Re-parse using dynamic import to avoid circular dep
      const { parseSkillMd } = await import("./skill-parser.js");
      const updated = parseSkillMd(record.domain, skillMd, { isFirstParty: record.isFirstParty });
      updated.createdAt = record.createdAt;
      updated.isDefault = record.isDefault;
      updated.version = record.version;
      updated.source = { ...record.source, lastRefresh: Date.now() };
      await this.store.put(record.domain, updated);
      return updated;
    }

    // JSON-RPC: method lists are static, just update timestamp
    if (record.source.type === "jsonrpc") {
      const updated: ServiceRecord = {
        ...record,
        source: { ...record.source, lastRefresh: Date.now() },
      };
      await this.store.put(record.domain, updated);
      return updated;
    }

    return null;
  }

  async refreshAll(): Promise<{ refreshed: string[]; errors: string[] }> {
    const services = await this.store.list();
    const refreshed: string[] = [];
    const errors: string[] = [];

    for (const summary of services) {
      const record = await this.store.get(summary.domain);
      if (!record) continue;
      if (!(await this.shouldRefresh(record))) continue;

      try {
        const updated = await this.refresh(record);
        if (updated) refreshed.push(record.domain);
      } catch {
        errors.push(record.domain);
      }
    }

    return { refreshed, errors };
  }
}
