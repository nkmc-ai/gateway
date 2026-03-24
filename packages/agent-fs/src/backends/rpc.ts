import type { FsBackend } from "../types.js";
import { NotFoundError } from "./memory.js";

// --- Types ---

/** Transport interface for RPC calls */
export interface RpcTransport {
  call(method: string, params: unknown[]): Promise<unknown>;
  batch?(
    calls: Array<{ method: string; params: unknown[] }>,
  ): Promise<unknown[]>;
}

/** Configuration for JSON-RPC 2.0 transport */
export interface JsonRpcTransportConfig {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Retry configuration for transient errors (429, 5xx, -32603, -32000~-32099) */
  retry?: {
    /** Max retry attempts (default 3) */
    maxRetries?: number;
    /** Base delay in ms for exponential backoff (default 1000) */
    baseDelayMs?: number;
  };
}

/** JSON-RPC error with code and optional data */
export class RpcError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/** Context passed to RpcMethod.params callback */
export interface RpcCallContext {
  id?: string;
  data?: unknown;
  pattern?: string;
}

/** Maps a filesystem operation to an RPC call */
export interface RpcMethod {
  method: string;
  params: (ctx: RpcCallContext) => unknown[];
}

/** A resource exposed as a directory in the filesystem */
export interface RpcResource {
  name: string;
  idField?: string;

  methods: {
    list?: RpcMethod;
    read?: RpcMethod;
    write?: RpcMethod;
    create?: RpcMethod;
    remove?: RpcMethod;
    search?: RpcMethod;
  };

  transform?: {
    read?: (data: unknown) => unknown;
    write?: (data: unknown) => unknown;
    remove?: (id: string) => unknown;
    list?: (item: unknown) => string | string[];
  };
}

/** Configuration for RpcBackend */
export interface RpcBackendConfig {
  transport: RpcTransport;
  resources: RpcResource[];
}

// --- Internal helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely parse JSON from a Response.
 * Unlike HTTP safeJson (which returns null for empty/invalid), this throws RpcError
 * because JSON-RPC protocol requires responses to be valid JSON.
 */
async function safeRpcJson(resp: Response): Promise<any> {
  const text = await resp.text();
  if (!text || !text.trim()) {
    throw new RpcError(-32700, "Parse error: empty response body");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RpcError(-32700, `Parse error: invalid JSON response`);
  }
}

/** Deterministic RPC errors that should NOT be retried */
const NON_RETRYABLE_RPC_CODES = new Set([-32700, -32600, -32601, -32602]);

/** Check if an RPC error code is retryable (-32603 internal, -32000~-32099 server) */
function isRetryableRpcError(code: number): boolean {
  if (NON_RETRYABLE_RPC_CODES.has(code)) return false;
  // -32603 (internal error) or server errors (-32000 to -32099)
  return code === -32603 || (code >= -32099 && code <= -32000);
}

/** Check if an HTTP status code is retryable (429, 5xx) */
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// --- JSON-RPC 2.0 Transport ---

export class JsonRpcTransport implements RpcTransport {
  private url: string;
  private headers: Record<string, string>;
  private _fetch: typeof globalThis.fetch;
  private nextId = 1;
  private retryConfig: { maxRetries: number; baseDelayMs: number };

  constructor(config: JsonRpcTransportConfig) {
    this.url = config.url;
    this.headers = config.headers ?? {};
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 3,
      baseDelayMs: config.retry?.baseDelayMs ?? 1000,
    };
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const headers = { "Content-Type": "application/json", ...this.headers };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      let resp: Response;
      try {
        resp = await this._fetch(this.url, { method: "POST", headers, body });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retryConfig.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw lastError;
      }

      // HTTP-level retry (429, 5xx)
      if (isRetryableHttpStatus(resp.status)) {
        lastError = new RpcError(-32000, `HTTP ${resp.status}`);
        if (attempt < this.retryConfig.maxRetries) {
          await this.backoff(attempt, resp);
          continue;
        }
        throw lastError;
      }

      // Parse JSON safely
      const result = await safeRpcJson(resp);

      // RPC-level error handling
      if (result.error) {
        const { code, message, data } = result.error;
        if (isRetryableRpcError(code) && attempt < this.retryConfig.maxRetries) {
          lastError = new RpcError(code, message, data);
          await this.backoff(attempt);
          continue;
        }
        throw new RpcError(code, message, data);
      }

      return result.result;
    }

    throw lastError ?? new RpcError(-32000, "Max retries exhausted");
  }

  async batch(
    calls: Array<{ method: string; params: unknown[] }>,
  ): Promise<unknown[]> {
    const requests = calls.map((c) => ({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: c.method,
      params: c.params,
    }));
    const body = JSON.stringify(requests);
    const headers = { "Content-Type": "application/json", ...this.headers };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      let resp: Response;
      try {
        resp = await this._fetch(this.url, { method: "POST", headers, body });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retryConfig.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw lastError;
      }

      // HTTP-level retry (429, 5xx)
      if (isRetryableHttpStatus(resp.status)) {
        lastError = new RpcError(-32000, `HTTP ${resp.status}`);
        if (attempt < this.retryConfig.maxRetries) {
          await this.backoff(attempt, resp);
          continue;
        }
        throw lastError;
      }

      // Parse JSON safely
      const results = await safeRpcJson(resp);

      // Check for retryable RPC errors in batch results
      const sorted = (results as Array<{ id: number; result?: unknown; error?: { code: number; message: string; data?: unknown } }>)
        .sort((a, b) => a.id - b.id);

      const hasRetryableError = sorted.some(
        (r) => r.error && isRetryableRpcError(r.error.code),
      );

      if (hasRetryableError && attempt < this.retryConfig.maxRetries) {
        const firstErr = sorted.find((r) => r.error)!.error!;
        lastError = new RpcError(firstErr.code, firstErr.message, firstErr.data);
        await this.backoff(attempt);
        continue;
      }

      return sorted.map((r) => {
        if (r.error) {
          throw new RpcError(r.error.code, r.error.message, r.error.data);
        }
        return r.result;
      });
    }

    throw lastError ?? new RpcError(-32000, "Max retries exhausted");
  }

  /** Exponential backoff with jitter + Retry-After header support */
  private async backoff(attempt: number, resp?: Response): Promise<void> {
    let delayMs: number;
    const retryAfter = resp?.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      delayMs = isNaN(seconds) ? this.retryConfig.baseDelayMs : seconds * 1000;
    } else {
      delayMs = this.retryConfig.baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
    }
    await sleep(delayMs);
  }
}

// --- RpcBackend ---

type ParsedPath =
  | { type: "root" }
  | { type: "resource-list"; resource: RpcResource }
  | { type: "resource-item"; resource: RpcResource; id: string };

export class RpcBackend implements FsBackend {
  private transport: RpcTransport;
  private resources: RpcResource[];

  constructor(config: RpcBackendConfig) {
    this.transport = config.transport;
    this.resources = config.resources;
  }

  async list(path: string): Promise<string[]> {
    const parsed = this.parsePath(path);

    if (parsed.type === "root") {
      return this.resources
        .filter((r) => r.methods.list || r.methods.read)
        .map((r) => r.name + "/");
    }

    if (parsed.type === "resource-list") {
      const { resource } = parsed;
      if (!resource.methods.list) return [];

      const { method, params } = resource.methods.list;
      const result = await this.transport.call(method, params({}));

      if (resource.transform?.list) {
        const transformed = resource.transform.list(result);
        return Array.isArray(transformed) ? transformed : [transformed];
      }

      if (Array.isArray(result)) {
        const idField = resource.idField ?? "id";
        return result.map(
          (item: unknown) =>
            String((item as Record<string, unknown>)[idField]) + ".json",
        );
      }

      return [];
    }

    return [];
  }

  async read(path: string): Promise<unknown> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-item") {
      const { resource, id } = parsed;

      if (!resource.methods.read) {
        throw new NotFoundError(path);
      }

      const { method, params } = resource.methods.read;
      const result = await this.transport.call(method, params({ id }));

      if (result === null || result === undefined) {
        throw new NotFoundError(path);
      }

      return resource.transform?.read ? resource.transform.read(result) : result;
    }

    if (parsed.type === "resource-list") {
      const { resource } = parsed;
      if (!resource.methods.list) {
        throw new NotFoundError(path);
      }

      const { method, params } = resource.methods.list;
      return this.transport.call(method, params({}));
    }

    throw new NotFoundError(path);
  }

  async write(path: string, data: unknown): Promise<{ id: string }> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-item") {
      const { resource, id } = parsed;
      const rpcMethod = resource.methods.write ?? resource.methods.create;
      if (!rpcMethod) throw new Error(`Cannot write to path: ${path}`);

      const writeData = resource.transform?.write
        ? resource.transform.write(data)
        : data;
      const { method, params } = rpcMethod;
      const result = await this.transport.call(method, params({ id, data: writeData }));
      return { id: String(result ?? id) };
    }

    if (parsed.type === "resource-list") {
      const { resource } = parsed;
      const rpcMethod = resource.methods.create ?? resource.methods.write;
      if (!rpcMethod) throw new Error(`Cannot write to path: ${path}`);

      const writeData = resource.transform?.write
        ? resource.transform.write(data)
        : data;
      const { method, params } = rpcMethod;
      const result = await this.transport.call(method, params({ data: writeData }));
      return { id: String(result ?? "unknown") };
    }

    throw new Error(`Cannot write to path: ${path}`);
  }

  async remove(path: string): Promise<void> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-item") {
      const { resource, id } = parsed;
      if (!resource.methods.remove) {
        throw new Error(`Cannot remove path: ${path}`);
      }

      const { method, params } = resource.methods.remove;
      await this.transport.call(method, params({ id }));
      return;
    }

    throw new Error(`Cannot remove path: ${path}`);
  }

  async search(path: string, pattern: string): Promise<unknown[]> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-list" || parsed.type === "resource-item") {
      const { resource } = parsed;

      // Try dedicated search method
      if (resource.methods.search) {
        const { method, params } = resource.methods.search;
        const result = await this.transport.call(method, params({ pattern }));
        if (Array.isArray(result)) return result;
        return [result];
      }

      // Fallback: list + client-side filter
      if (resource.methods.list) {
        const { method, params } = resource.methods.list;
        const result = await this.transport.call(method, params({}));
        if (Array.isArray(result)) {
          return result.filter((item: unknown) =>
            JSON.stringify(item).includes(pattern),
          );
        }
        if (JSON.stringify(result).includes(pattern)) {
          return [result];
        }
      }
    }

    return [];
  }

  // --- Internal ---

  private parsePath(path: string): ParsedPath {
    const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!cleaned) return { type: "root" };

    const parts = cleaned.split("/");
    const resourceName = parts[0];
    const resource = this.resources.find((r) => r.name === resourceName);
    if (!resource) throw new NotFoundError(`Invalid path: ${path}`);

    if (parts.length === 1) {
      return { type: "resource-list", resource };
    }

    // All remaining segments form the ID (support composite IDs)
    let id = parts.slice(1).join("/");
    if (id.endsWith(".json")) id = id.slice(0, -5);

    return { type: "resource-item", resource, id };
  }
}
