import type { RegistryStore, SearchResult, ServiceRecord, ServiceSummary, VersionSummary } from "./types.js";

export class MemoryRegistryStore implements RegistryStore {
  // key = "domain@version"
  private records = new Map<string, ServiceRecord>();

  private key(domain: string, version: string): string {
    return `${domain}@${version}`;
  }

  async get(domain: string): Promise<ServiceRecord | null> {
    for (const record of this.records.values()) {
      if (record.domain === domain && record.isDefault) return record;
    }
    return null;
  }

  async getVersion(domain: string, version: string): Promise<ServiceRecord | null> {
    return this.records.get(this.key(domain, version)) ?? null;
  }

  async listVersions(domain: string): Promise<VersionSummary[]> {
    const versions: VersionSummary[] = [];
    for (const record of this.records.values()) {
      if (record.domain === domain) {
        versions.push({
          version: record.version,
          status: record.status,
          isDefault: record.isDefault,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      }
    }
    return versions.sort((a, b) => b.createdAt - a.createdAt);
  }

  async put(domain: string, record: ServiceRecord): Promise<void> {
    this.records.set(this.key(domain, record.version), record);
  }

  async delete(domain: string): Promise<void> {
    const keysToDelete: string[] = [];
    for (const [key, record] of this.records.entries()) {
      if (record.domain === domain) keysToDelete.push(key);
    }
    for (const key of keysToDelete) {
      this.records.delete(key);
    }
  }

  async list(): Promise<ServiceSummary[]> {
    const results: ServiceSummary[] = [];
    for (const record of this.records.values()) {
      if (record.isDefault) results.push(toSummary(record));
    }
    return results;
  }

  async search(query: string): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const record of this.records.values()) {
      if (!record.isDefault) continue;

      const nameMatch =
        record.name.toLowerCase().includes(q) ||
        record.description.toLowerCase().includes(q);

      const matched = record.endpoints.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q),
      );

      if (nameMatch || matched.length > 0) {
        results.push({
          ...toSummary(record),
          matchedEndpoints: matched.map((e) => ({
            method: e.method,
            path: e.path,
            description: e.description,
          })),
        });
      }
    }

    return results;
  }
}

function toSummary(record: ServiceRecord): ServiceSummary {
  return {
    domain: record.domain,
    name: record.name,
    description: record.description,
    isFirstParty: record.isFirstParty,
  };
}
