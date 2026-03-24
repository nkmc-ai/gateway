import type { FsBackend } from "../types.js";
import { NotFoundError } from "./memory.js";

/** Auth configuration for HTTP requests */
export type HttpAuth =
  | { type: "bearer"; token: string; prefix?: string }
  | { type: "api-key"; header: string; key: string }
  | { type: "basic"; username: string; password: string }
  | { type: "oauth2"; tokenUrl: string; clientId: string; clientSecret: string; scope?: string };

/** A resource (collection-like, from skill.md Schema section) */
export interface HttpResource {
  /** Name used in filesystem path: /mount/{name}/ */
  name: string;
  /** API base path for this resource. Defaults to /{name} */
  apiPath?: string;
  /** Field name for record ID in API responses. Defaults to "id" */
  idField?: string;
  /** Key to extract array from list response. e.g. "result" for Cloudflare, "data" for others */
  listKey?: string;
  /** Schema fields (for _schema support) */
  fields?: { name: string; type: string; description?: string }[];
  /** Child resources (for nested paths like /zones/{id}/dns_records) */
  children?: HttpResource[];

  /** "tree" mode: all remaining path segments form the ID (for file-tree APIs) */
  pathMode?: "tree";

  /** Override HTTP method for updates. Default "PUT" */
  updateMethod?: "PUT" | "PATCH";

  /** Data transformation hooks */
  transform?: {
    /** Transform item after GET response */
    read?: (data: unknown) => unknown;
    /** Transform data before POST/PUT body */
    write?: (data: unknown) => unknown;
    /** Build DELETE body from read result */
    remove?: (readResult: unknown | null) => unknown;
    /** Format each list item to display string. Default: item[idField] + ".json" */
    list?: (item: unknown) => string;
  };

  /** Auto-read before write/delete to obtain fields like SHA, ETag */
  readBeforeWrite?: {
    inject: (readResult: unknown, writeData: unknown) => unknown;
  };
}

/** An API endpoint (invocation-like, from skill.md API section) */
export interface HttpEndpoint {
  /** Name used in filesystem path: /mount/_api/{name} */
  name: string;
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** API path */
  apiPath: string;
  /** Description */
  description?: string;
}

/** Configuration for HttpBackend */
export interface HttpBackendConfig {
  /** Base URL of the API (e.g. "https://api.cloudflare.com/client/v4") */
  baseUrl: string;
  /** Authentication */
  auth?: HttpAuth;
  /** Resource definitions (from skill.md Schema section) */
  resources?: HttpResource[];
  /** API endpoint definitions (from skill.md API section) */
  endpoints?: HttpEndpoint[];
  /** Static parameters for template resolution (e.g. { accountId: "abc123" }) */
  params?: Record<string, string>;
  /** Body encoding: "json" (default) or "form" (application/x-www-form-urlencoded) */
  bodyEncoding?: "json" | "form";

  /** Custom fetch function (for testing) */
  fetch?: typeof globalThis.fetch;

  /** Auto-pagination for list operations */
  pagination?: PaginationConfig;

  /** Retry configuration for transient errors (429, 5xx) */
  retry?: {
    /** Max retry attempts (default 3) */
    maxRetries?: number;
    /** Base delay in ms for exponential backoff (default 1000) */
    baseDelayMs?: number;
  };
}

/** Pagination configuration — supports multiple strategies */
export type PaginationConfig =
  | { type: "link-header"; maxPages?: number }
  | { type: "cursor"; cursorParam: string; cursorPath: string; maxPages?: number }
  | { type: "offset"; offsetParam?: string; limitParam?: string; pageSize?: number; maxPages?: number }
  | { type: "page"; pageParam?: string; maxPages?: number };

/**
 * HTTP-based FsBackend driven by skill.md descriptions.
 *
 * Filesystem mapping (flat):
 *   ls /                        → list resources + endpoints
 *   ls /{resource}/             → GET baseUrl/{apiPath}  (list records)
 *   cat /{resource}/{id}.json   → GET baseUrl/{apiPath}/{id}  (read record)
 *   write /{resource}/ data     → POST baseUrl/{apiPath}  (create)
 *   write /{resource}/{id} data → PUT baseUrl/{apiPath}/{id}  (update)
 *   rm /{resource}/{id}.json    → DELETE baseUrl/{apiPath}/{id}
 *   grep pattern /{resource}/   → GET baseUrl/{apiPath}?q={pattern}  (search)
 *
 * Nested resources:
 *   ls /{parent}/{pid}/                   → list child resource directories
 *   ls /{parent}/{pid}/{child}/           → GET resolved nested path (list)
 *   cat /{parent}/{pid}/{child}/{id}.json → GET resolved nested path/{id}
 *
 * Endpoints:
 *   ls /_api/                   → list available endpoints
 *   cat /_api/{name}            → GET endpoint (for GET endpoints)
 *   write /_api/{name} data     → POST/PUT/etc endpoint (for non-GET endpoints)
 */
export class HttpBackend implements FsBackend {
  private baseUrl: string;
  private auth?: HttpAuth;
  private resourceList: HttpResource[];
  private endpoints: Map<string, HttpEndpoint>;
  private params: Record<string, string>;
  private _fetch: typeof globalThis.fetch;
  private bodyEncoding: "json" | "form";
  private pagination?: PaginationConfig & { maxPages: number };
  private retryConfig: { maxRetries: number; baseDelayMs: number };
  /** Cached OAuth2 access token */
  private _oauth2Token?: { token: string; expiresAt: number };

  constructor(config: HttpBackendConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.auth = config.auth;
    this.resourceList = config.resources ?? [];
    this.endpoints = new Map(
      (config.endpoints ?? []).map((e) => [e.name, e]),
    );
    this.params = config.params ?? {};
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.bodyEncoding = config.bodyEncoding ?? "json";
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 3,
      baseDelayMs: config.retry?.baseDelayMs ?? 1000,
    };
    if (config.pagination) {
      this.pagination = {
        ...config.pagination,
        maxPages: config.pagination.maxPages ?? 10,
      };
    }
  }

  async list(path: string): Promise<string[]> {
    const parsed = this.parsePath(path);

    // Root: list all top-level resources and _api
    if (parsed.type === "root") {
      const entries: string[] = [];
      for (const r of this.resourceList) {
        entries.push(r.name + "/");
      }
      if (this.endpoints.size > 0) {
        entries.push("_api/");
      }
      return entries;
    }

    // List endpoints
    if (parsed.type === "api-list") {
      return Array.from(this.endpoints.values()).map(
        (e) => `${e.name} [${e.method}]`,
      );
    }

    // List records in a resource
    if (parsed.type === "resource-list") {
      const { resource, resolvedApiPath } = parsed;
      const items = await this.fetchAllItems(resource, resolvedApiPath);
      if (!Array.isArray(items)) return [];
      return this.formatListItems(resource, items);
    }

    // Passthrough: proxy the list request directly
    if (parsed.type === "passthrough") {
      const resp = await this.request("GET", parsed.apiPath);
      if (!resp.ok) return [];
      const data = await safeJson(resp);
      if (data === null) return [];
      if (Array.isArray(data)) return data.map((item: any) => String(item.id ?? item.name ?? JSON.stringify(item)));
      return Object.keys(data);
    }

    // Intermediate node with children: list child resource directories
    if (parsed.type === "resource-item") {
      const { resource, resolvedApiPath, id } = parsed;

      // tree mode resource-item: GET the path, if array → directory listing
      if (resource.pathMode === "tree") {
        const resp = await this.request("GET", `${resolvedApiPath}/${id}`);
        if (!resp.ok) return [];
        const data = await safeJson(resp);
        if (data === null) return [];
        if (Array.isArray(data)) {
          return this.formatListItems(resource, data);
        }
        return [];
      }

      if (resource.children && resource.children.length > 0) {
        return resource.children.map((c) => c.name + "/");
      }
      return [];
    }

    return [];
  }

  async read(path: string): Promise<unknown> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-item") {
      const { resource, resolvedApiPath, id } = parsed;

      // Special: _schema
      if (id === "_schema") {
        return {
          resource: resource.name,
          fields: resource.fields ?? [],
        };
      }

      // Special: _count
      if (id === "_count") {
        const resp = await this.request("GET", resolvedApiPath);
        const data = await safeJson(resp) ?? {};
        const items = extractList(data, resource.listKey);
        return { count: Array.isArray(items) ? items.length : 0 };
      }

      const resp = await this.request("GET", `${resolvedApiPath}/${id}`);
      if (!resp.ok) throw new NotFoundError(path);
      let result = await safeJson(resp);
      if (resource.transform?.read) result = resource.transform.read(result);
      return result;
    }

    // Read all records in a resource (cat /resource/)
    if (parsed.type === "resource-list") {
      const { resource, resolvedApiPath } = parsed;
      const resp = await this.request("GET", resolvedApiPath);
      const data = await safeJson(resp);
      return data === null ? [] : extractList(data, resource.listKey) ?? data;
    }

    // Invoke a GET endpoint
    if (parsed.type === "api-call") {
      const endpoint = this.getEndpoint(parsed.endpoint);
      const resp = await this.request(endpoint.method, endpoint.apiPath);
      return safeJson(resp);
    }

    // Passthrough: proxy the read request directly
    if (parsed.type === "passthrough") {
      const resp = await this.request("GET", parsed.apiPath);
      if (!resp.ok) throw new NotFoundError(path);
      return safeJson(resp);
    }

    throw new NotFoundError(path);
  }

  async write(path: string, data: unknown): Promise<{ id: string }> {
    const parsed = this.parsePath(path);

    // Passthrough root: POST to / when no resources and no endpoints
    if (parsed.type === "root" && this.resourceList.length === 0 && this.endpoints.size === 0) {
      const resp = await this.request("POST", "/", data);
      const result = await safeJson(resp) ?? {};
      return { id: String(result.id ?? "ok") };
    }

    if (parsed.type === "resource-item" && parsed.id) {
      // Update: PUT/PATCH /resource/{id}
      const { resource, resolvedApiPath, id } = parsed;
      let writeData = data;

      // readBeforeWrite: auto-read to obtain fields like SHA
      if (resource.readBeforeWrite) {
        try {
          const readResp = await this.request(
            "GET",
            `${resolvedApiPath}/${id}`,
          );
          if (readResp.ok) {
            const readResult = await safeJson(readResp);
            if (readResult) writeData = resource.readBeforeWrite.inject(readResult, writeData);
          }
          // 404 → skip inject (create scenario)
        } catch {
          // skip inject on error
        }
      }

      if (resource.transform?.write) writeData = resource.transform.write(writeData);

      const method = resource.updateMethod ?? "PUT";
      const resp = await this.request(
        method,
        `${resolvedApiPath}/${id}`,
        writeData,
      );
      if (!resp.ok) throw new NotFoundError(path);
      const result = await safeJson(resp) ?? {};
      const idField = resource.idField ?? "id";
      return { id: String(result[idField] ?? id) };
    }

    if (parsed.type === "resource-list") {
      // Create: POST /resource/
      const { resource, resolvedApiPath } = parsed;
      let writeData = data;
      if (resource.transform?.write) writeData = resource.transform.write(writeData);
      const resp = await this.request("POST", resolvedApiPath, writeData);
      const result = await safeJson(resp) ?? {};
      const idField = resource.idField ?? "id";
      return { id: String(result[idField] ?? "unknown") };
    }

    if (parsed.type === "api-call") {
      // Invoke endpoint with body
      const endpoint = this.getEndpoint(parsed.endpoint);
      const resp = await this.request(endpoint.method, endpoint.apiPath, data);
      const result = await safeJson(resp) ?? {};
      return { id: result.id ?? "ok" };
    }

    // Passthrough: proxy the write request directly
    if (parsed.type === "passthrough") {
      const method = parsed.apiPath === "/" ? "POST" : "PUT";
      const resp = await this.request(method, parsed.apiPath, data);
      const result = await safeJson(resp) ?? {};
      return { id: String(result.id ?? "ok") };
    }

    throw new Error(`Cannot write to path: ${path}`);
  }

  async remove(path: string): Promise<void> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-item" && parsed.id) {
      const { resource, resolvedApiPath, id } = parsed;

      let deleteBody: unknown | undefined;

      // readBeforeWrite: auto-read to get fields like SHA for delete body
      if (resource.readBeforeWrite) {
        const readResp = await this.request(
          "GET",
          `${resolvedApiPath}/${id}`,
        );
        if (!readResp.ok) throw new NotFoundError(path);
        const readResult = await safeJson(readResp);
        if (resource.transform?.remove) {
          deleteBody = resource.transform.remove(readResult);
        }
      } else if (resource.transform?.remove) {
        deleteBody = resource.transform.remove(null);
      }

      const resp = await this.request(
        "DELETE",
        `${resolvedApiPath}/${id}`,
        deleteBody,
      );
      if (!resp.ok) throw new NotFoundError(path);
      return;
    }

    // Passthrough: proxy the delete request directly
    if (parsed.type === "passthrough") {
      const resp = await this.request("DELETE", parsed.apiPath);
      if (!resp.ok) throw new NotFoundError(path);
      return;
    }

    throw new Error(`Cannot remove path: ${path}`);
  }

  async search(path: string, pattern: string): Promise<unknown[]> {
    const parsed = this.parsePath(path);

    if (parsed.type === "resource-list" || parsed.type === "resource-item") {
      const { resource, resolvedApiPath } = parsed;
      // Try server-side search first
      const resp = await this.request(
        "GET",
        `${resolvedApiPath}?q=${encodeURIComponent(pattern)}`,
      );
      const data = await safeJson(resp) ?? {};
      const items = extractList(data, resource.listKey);

      if (Array.isArray(items)) return items;

      // Fallback: client-side filter
      const allResp = await this.request("GET", resolvedApiPath);
      const allData = await safeJson(allResp) ?? {};
      const allItems = extractList(allData, resource.listKey);
      if (!Array.isArray(allItems)) return [];
      return allItems.filter((item: unknown) =>
        JSON.stringify(item).includes(pattern),
      );
    }

    // Passthrough: proxy the search request directly
    if (parsed.type === "passthrough") {
      const resp = await this.request("GET", `${parsed.apiPath}?q=${encodeURIComponent(pattern)}`);
      const data = await safeJson(resp);
      return Array.isArray(data) ? data : [];
    }

    return [];
  }

  // --- Internal helpers ---

  private async request(
    method: string,
    apiPath: string,
    body?: unknown,
    absoluteUrl?: boolean,
  ): Promise<Response> {
    const url = absoluteUrl ? apiPath : `${this.baseUrl}${apiPath}`;
    const useForm = this.bodyEncoding === "form";
    const headers: Record<string, string> = {
      "Content-Type": useForm ? "application/x-www-form-urlencoded" : "application/json",
      Accept: "application/json",
      "User-Agent": "nkmc-gateway/1.0",
    };

    if (this.auth) {
      switch (this.auth.type) {
        case "bearer": {
          const prefix = this.auth.prefix ?? "Bearer";
          headers["Authorization"] = `${prefix} ${this.auth.token}`;
          break;
        }
        case "api-key":
          headers[this.auth.header] = this.auth.key;
          break;
        case "basic":
          headers["Authorization"] =
            `Basic ${btoa(`${this.auth.username}:${this.auth.password}`)}`;
          break;
        case "oauth2": {
          const token = await this.getOAuth2Token();
          headers["Authorization"] = `Bearer ${token}`;
          break;
        }
      }
    }

    let encodedBody: string | undefined;
    if (body !== undefined) {
      encodedBody = useForm ? encodeFormBody(body) : JSON.stringify(body);
    }

    // Retry loop for transient errors (429, 5xx)
    let lastResp: Response | undefined;
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      lastResp = await this._fetch(url, {
        method,
        headers,
        body: encodedBody,
      });

      // Don't retry on success or client errors (except 429)
      if (lastResp.ok || (lastResp.status >= 400 && lastResp.status < 500 && lastResp.status !== 429)) {
        return lastResp;
      }

      // Last attempt — don't wait, just return
      if (attempt === this.retryConfig.maxRetries) break;

      // Calculate delay: respect Retry-After header, or exponential backoff with jitter
      let delayMs: number;
      const retryAfter = lastResp.headers.get("retry-after");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        delayMs = isNaN(seconds) ? this.retryConfig.baseDelayMs : seconds * 1000;
      } else {
        delayMs = this.retryConfig.baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      }
      await sleep(delayMs);
    }

    return lastResp!;
  }

  /** Obtain (or refresh) OAuth2 access token via client_credentials grant */
  private async getOAuth2Token(): Promise<string> {
    if (this.auth?.type !== "oauth2") throw new Error("Not OAuth2 auth");

    // Return cached token if still valid (with 30s buffer)
    if (this._oauth2Token && Date.now() < this._oauth2Token.expiresAt - 30_000) {
      return this._oauth2Token.token;
    }

    const { tokenUrl, clientId, clientSecret, scope } = this.auth;
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    if (scope) params.set("scope", scope);

    const resp = await this._fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      throw new Error(`OAuth2 token request failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    const expiresIn = data.expires_in ?? 3600;
    this._oauth2Token = {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return this._oauth2Token.token;
  }

  /** Parse Link header to extract rel="next" URL */
  private getNextPageUrl(resp: Response): string | null {
    const link = resp.headers.get("link");
    if (!link) return null;
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }

  /** Fetch all items with optional pagination */
  private async fetchAllItems(
    resource: HttpResource,
    apiPath: string,
  ): Promise<unknown[]> {
    const resp = await this.request("GET", apiPath);
    const data = await safeJson(resp);
    if (data === null) return [];
    let items: unknown[] = extractList(data, resource.listKey);
    if (!Array.isArray(items)) return [];

    // Follow pagination if configured
    if (this.pagination) {
      const maxPages = this.pagination.maxPages;
      let pages = 1;

      if (this.pagination.type === "link-header") {
        let nextUrl = this.getNextPageUrl(resp);
        while (nextUrl && pages < maxPages) {
          const nextResp = await this.request("GET", nextUrl, undefined, true);
          const nextData = await safeJson(nextResp);
          if (!nextData) break;
          const nextItems = extractList(nextData, resource.listKey);
          if (!Array.isArray(nextItems) || nextItems.length === 0) break;
          items = items.concat(nextItems);
          nextUrl = this.getNextPageUrl(nextResp);
          pages++;
        }
      } else if (this.pagination.type === "cursor") {
        const { cursorParam, cursorPath } = this.pagination;
        let cursor = getNestedValue(data, cursorPath);
        while (cursor && pages < maxPages) {
          const sep = apiPath.includes("?") ? "&" : "?";
          const nextResp = await this.request("GET", `${apiPath}${sep}${cursorParam}=${encodeURIComponent(String(cursor))}`);
          const nextData = await safeJson(nextResp);
          if (!nextData) break;
          const nextItems = extractList(nextData, resource.listKey);
          if (!Array.isArray(nextItems) || nextItems.length === 0) break;
          items = items.concat(nextItems);
          cursor = getNestedValue(nextData, cursorPath);
          pages++;
        }
      } else if (this.pagination.type === "offset") {
        const { offsetParam = "offset", limitParam = "limit", pageSize = 100 } = this.pagination;
        let offset = items.length;
        while (pages < maxPages) {
          const sep = apiPath.includes("?") ? "&" : "?";
          const nextResp = await this.request("GET", `${apiPath}${sep}${offsetParam}=${offset}&${limitParam}=${pageSize}`);
          const nextData = await safeJson(nextResp);
          if (!nextData) break;
          const nextItems = extractList(nextData, resource.listKey);
          if (!Array.isArray(nextItems) || nextItems.length === 0) break;
          items = items.concat(nextItems);
          offset += nextItems.length;
          pages++;
        }
      } else if (this.pagination.type === "page") {
        const { pageParam = "page" } = this.pagination;
        let page = 2; // first page already fetched
        while (pages < maxPages) {
          const sep = apiPath.includes("?") ? "&" : "?";
          const nextResp = await this.request("GET", `${apiPath}${sep}${pageParam}=${page}`);
          const nextData = await safeJson(nextResp);
          if (!nextData) break;
          const nextItems = extractList(nextData, resource.listKey);
          if (!Array.isArray(nextItems) || nextItems.length === 0) break;
          items = items.concat(nextItems);
          page++;
          pages++;
        }
      }
    }

    return items;
  }

  /** Format list items using transform.list or default idField + ".json" */
  private formatListItems(resource: HttpResource, items: unknown[]): string[] {
    if (resource.transform?.list) {
      return items.map((item) => resource.transform!.list!(item));
    }
    const idField = resource.idField ?? "id";
    return items.map(
      (item: unknown) =>
        String((item as Record<string, unknown>)[idField]) + ".json",
    );
  }

  private getEndpoint(name: string): HttpEndpoint {
    const endpoint = this.endpoints.get(name);
    if (!endpoint) throw new NotFoundError(`Endpoint not found: ${name}`);
    return endpoint;
  }

  /** Replace :param and {param} placeholders in API paths with values from config.params */
  private resolveTemplate(path: string): string {
    return path
      .replace(/:(\w+)/g, (_, key) => {
        const value = this.params[key];
        if (value === undefined) throw new Error(`Missing param: ${key}`);
        return value;
      })
      .replace(/\{(\w+)\}/g, (_, key) => {
        const value = this.params[key];
        if (value === undefined) throw new Error(`Missing param: ${key}`);
        return value;
      });
  }

  /** Recursively resolve a filesystem path against the resource tree */
  private resolveResourcePath(
    parts: string[],
    pos: number,
    resources: HttpResource[],
    parentApiPath: string,
  ): ParsedPath | null {
    if (pos >= parts.length) return null;

    const resourceName = parts[pos];
    const resource = resources.find((r) => r.name === resourceName);
    if (!resource) return null;

    const rawSegment = resource.apiPath ?? `/${resource.name}`;
    const resolvedSegment = this.resolveTemplate(rawSegment);
    const baseApiPath = parentApiPath + resolvedSegment;

    const remaining = parts.length - pos - 1;

    // Tree mode: all remaining segments form the ID
    if (resource.pathMode === "tree") {
      if (remaining === 0) {
        return { type: "resource-list", resource, resolvedApiPath: baseApiPath };
      }
      const id = parts.slice(pos + 1).join("/");
      return { type: "resource-item", resource, resolvedApiPath: baseApiPath, id };
    }

    // Just resource name → list
    if (remaining === 0) {
      return { type: "resource-list", resource, resolvedApiPath: baseApiPath };
    }

    // Next part is an ID (or ID.json)
    const rawId = parts[pos + 1];

    // If there are more parts after the id, try to match children first
    if (remaining >= 2) {
      if (resource.children) {
        const childResult = this.resolveResourcePath(
          parts,
          pos + 2,
          resource.children,
          baseApiPath + "/" + rawId,
        );
        if (childResult) return childResult;
      }
      // Unconsumed segments remain and no children matched → return null
      // so parsePath falls through to passthrough (direct proxy).
      return null;
    }

    // resource/id → item (all segments consumed)
    let id = rawId;
    if (id.endsWith(".json")) id = id.slice(0, -5);
    return { type: "resource-item", resource, resolvedApiPath: baseApiPath, id };
  }

  private parsePath(path: string): ParsedPath {
    const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!cleaned) return { type: "root" };

    const parts = cleaned.split("/");

    // _api/...
    if (parts[0] === "_api") {
      if (parts.length === 1) return { type: "api-list" };
      return { type: "api-call", endpoint: parts[1] };
    }

    // Recursive resource resolution
    const result = this.resolveResourcePath(
      parts,
      0,
      this.resourceList,
      "",
    );
    if (!result) {
      // Passthrough fallback: proxy unresolved paths directly to the upstream API.
      // This handles multi-segment OpenAPI paths (e.g. /repos/{owner}/{repo})
      // that the flat resource tree cannot model.
      return { type: "passthrough", apiPath: "/" + cleaned };
    }
    return result;
  }
}

type ParsedPath =
  | { type: "root" }
  | { type: "api-list" }
  | { type: "api-call"; endpoint: string }
  | {
      type: "resource-list";
      resource: HttpResource;
      resolvedApiPath: string;
    }
  | {
      type: "resource-item";
      resource: HttpResource;
      resolvedApiPath: string;
      id: string;
    }
  | { type: "passthrough"; apiPath: string };

// --- Utility functions ---

/** Safely parse JSON from a Response, returning null for 204 / empty body */
export async function safeJson(resp: Response): Promise<any> {
  if (resp.status === 204) return null;
  const text = await resp.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extract an array from a response object.
 * If listKey is set, use it. Otherwise auto-detect the best array-valued property.
 * Prefers non-empty arrays over empty ones.
 */
export function extractList(data: any, listKey?: string): unknown[] | any {
  if (Array.isArray(data)) return data;
  if (typeof data !== "object" || data === null) return data;
  // Explicit listKey
  if (listKey) return data[listKey];
  // Auto-detect: prefer the first non-empty array, fall back to first empty array
  let firstEmpty: unknown[] | null = null;
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      if (value.length > 0) return value;
      if (!firstEmpty) firstEmpty = value;
    }
  }
  if (firstEmpty) return firstEmpty;
  return data;
}

/** Resolve a dot-separated path to a nested value (e.g. "paging.next_cursor") */
export function getNestedValue(obj: any, path: string): unknown {
  let current = obj;
  for (const key of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encode an object as application/x-www-form-urlencoded.
 * Supports nested objects with Stripe-style bracket notation: metadata[key]=value
 */
export function encodeFormBody(data: unknown, prefix?: string): string {
  if (data === null || data === undefined) return "";
  if (typeof data !== "object") {
    return prefix ? `${encodeURIComponent(prefix)}=${encodeURIComponent(String(data))}` : "";
  }
  const parts: string[] = [];
  const obj = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(`${fullKey}[]`)}=${encodeURIComponent(String(item))}`);
      }
    } else if (value !== null && typeof value === "object") {
      const nested = encodeFormBody(value, fullKey);
      if (nested) parts.push(nested);
    } else if (value !== undefined) {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join("&");
}
