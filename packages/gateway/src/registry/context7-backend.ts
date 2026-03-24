import type { FsBackend } from "@nkmc/agent-fs";
import { Context7Client, type Context7Options, type LibrarySearchResult } from "./context7.js";

export interface Context7BackendOptions extends Context7Options {}

/**
 * FsBackend that maps filesystem operations to Context7 documentation queries.
 *
 * Filesystem mapping:
 *   grep "react" /         → searchLibraries("react")  — search for libraries
 *   cat /{owner}/{repo}    → queryDocs("/{owner}/{repo}", repo) — library overview
 *   grep "hooks" /{o}/{r}  → queryDocs("/{o}/{r}", "hooks")   — query specific docs
 *   ls /                   → usage instructions
 */
export class Context7Backend implements FsBackend {
  private client: Context7Client;

  constructor(options?: Context7BackendOptions) {
    this.client = new Context7Client(options);
  }

  async list(path: string): Promise<string[]> {
    const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!cleaned) {
      return [
        'grep "<关键词>" /context7/     — 搜索库',
        'grep "<问题>" /context7/{id}   — 查询文档',
        'cat /context7/{owner}/{repo}   — 库概览',
      ];
    }

    // ls /{owner}/{repo}/ — not much to list, return hint
    return ['grep "<问题>" /context7/' + cleaned + " — 查询此库文档"];
  }

  async read(path: string): Promise<unknown> {
    const libraryId = parseLibraryId(path);
    if (!libraryId) {
      return { usage: 'grep "<关键词>" /context7/ — 搜索库' };
    }

    // cat /{owner}/{repo} → query overview
    const name = libraryId.split("/").pop() ?? libraryId;
    const docs = await this.client.queryDocs(libraryId, `${name} overview getting started`);
    return { libraryId, docs };
  }

  async write(_path: string, _data: unknown): Promise<{ id: string }> {
    throw new Error("context7 is read-only");
  }

  async remove(_path: string): Promise<void> {
    throw new Error("context7 is read-only");
  }

  async search(path: string, pattern: string): Promise<unknown[]> {
    const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!cleaned) {
      // grep at root → search libraries
      const results = await this.client.searchLibraries(pattern);
      return results.map(formatSearchResult);
    }

    // grep at /{owner}/{repo} → query docs
    const libraryId = parseLibraryId(path);
    if (!libraryId) return [];

    const docs = await this.client.queryDocs(libraryId, pattern);
    if (!docs) return [];
    return [{ libraryId, query: pattern, docs }];
  }
}

function parseLibraryId(path: string): string | null {
  const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return null;

  // Expect owner/repo format
  const parts = cleaned.split("/");
  if (parts.length < 2) return null;
  return "/" + parts.slice(0, 2).join("/");
}

function formatSearchResult(r: LibrarySearchResult): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    snippets: r.totalSnippets ?? 0,
  };
}
