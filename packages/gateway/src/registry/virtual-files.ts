import type { FsBackend } from "@nkmc/agent-fs";
import type { RegistryStore } from "./types.js";

export interface VirtualFileOptions {
  inner: FsBackend;
  domain: string;
  store: RegistryStore;
}

const VIRTUAL_FILES = ["_pricing.json", "_versions.json", "skill.md"];

export class VirtualFileBackend implements FsBackend {
  private inner: FsBackend;
  private domain: string;
  private store: RegistryStore;

  constructor(options: VirtualFileOptions) {
    this.inner = options.inner;
    this.domain = options.domain;
    this.store = options.store;
  }

  async list(path: string): Promise<string[]> {
    const entries = await this.inner.list(path);
    // Append virtual files at root level
    if (path === "/" || path === "" || path === ".") {
      return [...entries, ...VIRTUAL_FILES];
    }
    return entries;
  }

  async read(path: string): Promise<unknown> {
    const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");

    if (cleaned === "_pricing.json") {
      const record = await this.store.get(this.domain);
      if (!record) return { endpoints: [] };
      return {
        domain: this.domain,
        endpoints: record.endpoints
          .filter((ep) => ep.pricing)
          .map((ep) => ({
            method: ep.method,
            path: ep.path,
            description: ep.description,
            pricing: ep.pricing,
          })),
      };
    }

    if (cleaned === "_versions.json") {
      const versions = await this.store.listVersions(this.domain);
      return { domain: this.domain, versions };
    }

    if (cleaned === "skill.md") {
      const record = await this.store.get(this.domain);
      if (!record) return "# Not found\n";
      return record.skillMd;
    }

    return this.inner.read(path);
  }

  async write(path: string, data: unknown): Promise<{ id: string }> {
    return this.inner.write(path, data);
  }

  async remove(path: string): Promise<void> {
    return this.inner.remove(path);
  }

  async search(path: string, pattern: string): Promise<unknown[]> {
    return this.inner.search(path, pattern);
  }
}
