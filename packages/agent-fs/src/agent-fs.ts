import type { AgentContext, FsCommand, FsResult, Mount } from "./types.js";
import { parseCommand } from "./parser.js";
import { MountResolver } from "./mount.js";
import { NotFoundError } from "./backends/memory.js";

export interface AgentFsOptions {
  mounts: Mount[];
  /** Called when a path doesn't match any static mount. Return true if you added a new mount. */
  onMiss?: (path: string, addMount: (mount: Mount) => void, agent?: AgentContext) => Promise<boolean>;
  /** Called on "ls /" to include dynamically-known domains. */
  listDomains?: () => Promise<string[]>;
  /** Called on "grep /" to search across registered services. */
  searchDomains?: (query: string) => Promise<unknown[]>;
  /** Called on "grep pattern /domain/" to search endpoint metadata within a single domain. */
  searchEndpoints?: (domain: string, query: string) => Promise<unknown[]>;
}

/**
 * The core engine: takes a raw command string, parses it,
 * routes to the correct backend, and returns a result.
 */
export class AgentFs {
  private resolver: MountResolver;
  private _listDomains?: () => Promise<string[]>;
  private _searchDomains?: (query: string) => Promise<unknown[]>;
  private _searchEndpoints?: (domain: string, query: string) => Promise<unknown[]>;

  constructor(options: AgentFsOptions) {
    this.resolver = new MountResolver();
    for (const mount of options.mounts) {
      this.resolver.add(mount);
    }
    if (options.onMiss) {
      const addMount = (mount: Mount) => this.resolver.add(mount);
      this.resolver.onMiss = (path, agent) => options.onMiss!(path, addMount, agent);
    }
    this._listDomains = options.listDomains;
    this._searchDomains = options.searchDomains;
    this._searchEndpoints = options.searchEndpoints;
  }

  /** Execute a raw command string like "ls /db/users/" */
  async execute(input: string, roles: string[] = ["agent"], agent?: AgentContext): Promise<FsResult> {
    // 1. Parse
    const parsed = parseCommand(input);
    if (!parsed.ok) return parsed;

    const cmd = parsed.data as FsCommand;
    return this.executeCommand(cmd, roles, agent);
  }

  /** Execute a pre-parsed FsCommand */
  async executeCommand(
    cmd: FsCommand,
    roles: string[] = ["agent"],
    agent?: AgentContext,
  ): Promise<FsResult> {
    // 2. Handle root listing
    if (cmd.path === "/" && cmd.op === "ls") {
      const staticEntries = this.resolver
        .listMounts()
        .map((p) => p.slice(1) + "/");
      if (this._listDomains) {
        const dynamicDomains = await this._listDomains();
        const dynamicEntries = dynamicDomains.map((d) => d + "/");
        const merged = [...new Set([...staticEntries, ...dynamicEntries])];
        return { ok: true, data: merged };
      }
      return { ok: true, data: staticEntries };
    }

    // 2b. Handle root grep
    if (cmd.path === "/" && cmd.op === "grep" && this._searchDomains) {
      const results = await this._searchDomains(cmd.pattern!);
      return { ok: true, data: results };
    }

    // 2c. Handle domain-level grep (e.g. "grep alerts /api.weather.gov/")
    if (cmd.op === "grep" && this._searchEndpoints) {
      const segments = cmd.path.split("/").filter(Boolean);
      if (segments.length === 1) {
        const domain = segments[0];
        const results = await this._searchEndpoints(domain, cmd.pattern!);
        return { ok: true, data: results };
      }
    }

    // 3. Resolve mount (async to support lazy loading via onMiss)
    const resolved = await this.resolver.resolveAsync(cmd.path, agent);
    if (!resolved) {
      return {
        ok: false,
        error: { code: "NO_MOUNT", message: `No mount for path: ${cmd.path}` },
      };
    }

    // 4. Check permissions
    const permType = cmd.op === "write" || cmd.op === "rm" ? "write" : "read";
    const permError = this.resolver.checkPermission(
      resolved.mount,
      permType,
      roles,
    );
    if (permError) {
      return { ok: false, error: permError };
    }

    // 5. Execute on backend
    const backend = resolved.mount.backend;
    const relPath = resolved.relativePath;

    try {
      switch (cmd.op) {
        case "ls": {
          const entries = await backend.list(relPath);
          return { ok: true, data: entries };
        }
        case "cat": {
          const data = await backend.read(relPath);
          return { ok: true, data };
        }
        case "write": {
          const result = await backend.write(relPath, cmd.data);
          return { ok: true, data: result };
        }
        case "rm": {
          await backend.remove(relPath);
          return { ok: true, data: { deleted: cmd.path } };
        }
        case "grep": {
          const results = await backend.search(relPath, cmd.pattern!);
          return { ok: true, data: results };
        }
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: err.message },
        };
      }
      return {
        ok: false,
        error: {
          code: "BACKEND_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
