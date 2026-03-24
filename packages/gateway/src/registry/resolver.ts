import { HttpBackend, RpcBackend, JsonRpcTransport } from "@nkmc/agent-fs";
import type { AgentContext, Mount, FsBackend, HttpAuth } from "@nkmc/agent-fs";
import type { JWK } from "jose";
import { signJwt } from "@nkmc/core";
import type { EndpointRecord, RegistryStore, SearchResult } from "./types.js";
import { skillToHttpConfig, skillToRpcConfig } from "./skill-to-config.js";
import { VirtualFileBackend } from "./virtual-files.js";
import type { PeerGateway } from "../federation/types.js";
import type { PeerClient } from "../federation/peer-client.js";
import { PeerBackend } from "../federation/peer-backend.js";

export interface RegistryResolverHooks {
  onMiss: (path: string, addMount: (mount: Mount) => void, agent?: AgentContext) => Promise<boolean>;
  listDomains: () => Promise<string[]>;
  searchDomains: (query: string) => Promise<SearchResult[]>;
  searchEndpoints: (domain: string, query: string) => Promise<Pick<EndpointRecord, "method" | "path" | "description">[]>;
}

export interface RegistryResolverOptions {
  store: RegistryStore;
  vault?: {
    get(domain: string, developerId?: string): Promise<{ auth: HttpAuth } | null>;
  };
  gatewayPrivateKey?: JWK;
  wrapVirtualFiles?: boolean;
  peerStore?: { listPeers(): Promise<PeerGateway[]> };
  peerClient?: PeerClient;
}

export function createRegistryResolver(
  storeOrOptions: RegistryStore | RegistryResolverOptions,
): RegistryResolverHooks {
  const options: RegistryResolverOptions =
    "get" in storeOrOptions && "put" in storeOrOptions
      ? { store: storeOrOptions }
      : storeOrOptions;
  const { store, vault, gatewayPrivateKey } = options;

  // cache key = "domain@version" or "domain"
  const loaded = new Set<string>();

  async function tryPeerFallback(
    domain: string,
    version: string | null,
    addMount: (mount: Mount) => void,
    agent?: AgentContext,
  ): Promise<boolean> {
    if (!options.peerClient || !options.peerStore) return false;

    const peers = await options.peerStore.listPeers();
    for (const peer of peers) {
      // Skip peers whose advertised domains don't include this domain
      if (peer.advertisedDomains.length > 0 && !peer.advertisedDomains.includes(domain)) {
        continue;
      }
      const result = await options.peerClient.query(peer, domain);
      if (result.available) {
        const peerBackend = new PeerBackend(options.peerClient, peer, agent?.id ?? "anonymous");
        const mountPath = version ? `/${domain}@${version}` : `/${domain}`;
        addMount({ path: mountPath, backend: peerBackend });
        return true;
      }
    }
    return false;
  }

  async function onMiss(
    path: string,
    addMount: (mount: Mount) => void,
    agent?: AgentContext,
  ): Promise<boolean> {
    const { domain, version } = extractDomainPath(path);
    if (!domain) return false;

    const cacheKey = version ? `${domain}@${version}` : domain;

    // Fetch record first — we need it to determine auth mode
    const record = version
      ? await store.getVersion(domain, version)
      : await store.get(domain);

    // No local record → try peer gateways before giving up
    if (!record) {
      return tryPeerFallback(domain, version, addMount, agent);
    }

    const isNkmcJwt = record.authMode === "nkmc-jwt";

    // For non-nkmc-jwt, use cache; nkmc-jwt needs fresh JWT per request
    if (!isNkmcJwt && loaded.has(cacheKey)) return false;

    // Reject sunset services
    if (record.status === "sunset") return false;

    // Resolve auth credentials
    let auth: HttpAuth | undefined;
    if (isNkmcJwt && gatewayPrivateKey && agent) {
      const token = await signJwt(gatewayPrivateKey, {
        sub: agent.id,
        roles: agent.roles,
        svc: domain,
      }, { expiresIn: "5m" });
      auth = { type: "bearer", token };
    } else if (vault) {
      const cred = await vault.get(domain, agent?.id);
      if (cred) {
        auth = cred.auth;
      }
    }

    // Local record exists but no credential resolved (and not nkmc-jwt) → try peers
    if (!auth && !isNkmcJwt) {
      const peerMounted = await tryPeerFallback(domain, version, addMount, agent);
      if (peerMounted) return true;
    }

    // Create backend based on source type
    let backend: FsBackend;
    if (record.source?.type === "jsonrpc" && record.source.rpc) {
      const { resources } = skillToRpcConfig(record.source.rpc);
      const headers: Record<string, string> = {};
      if (auth) {
        if (auth.type === "bearer") {
          headers["Authorization"] = `${(auth as any).prefix ?? "Bearer"} ${auth.token}`;
        } else if (auth.type === "api-key") {
          headers[auth.header] = auth.key;
        }
      }
      const transport = new JsonRpcTransport({ url: record.source.rpc.rpcUrl, headers });
      backend = new RpcBackend({ transport, resources });
    } else {
      const config = skillToHttpConfig(record);
      config.auth = auth;
      backend = new HttpBackend(config);
    }

    let finalBackend: FsBackend = backend;
    if (options.wrapVirtualFiles !== false) {
      finalBackend = new VirtualFileBackend({ inner: backend, domain, store: options.store });
    }

    const mountPath = version ? `/${domain}@${version}` : `/${domain}`;
    addMount({ path: mountPath, backend: finalBackend });

    // Only cache non-nkmc-jwt mounts
    if (!isNkmcJwt) {
      loaded.add(cacheKey);
    }
    return true;
  }

  async function listDomains(): Promise<string[]> {
    const summaries = await store.list();
    return summaries.map((s) => s.domain);
  }

  async function searchDomains(query: string): Promise<SearchResult[]> {
    return store.search(query);
  }

  async function searchEndpoints(
    domain: string,
    query: string,
  ): Promise<Pick<EndpointRecord, "method" | "path" | "description">[]> {
    const record = await store.get(domain);
    if (!record) return [];
    const q = query.toLowerCase();
    return record.endpoints
      .filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q),
      )
      .map((e) => ({ method: e.method, path: e.path, description: e.description }));
  }

  return { onMiss, listDomains, searchDomains, searchEndpoints };
}

export function extractDomainPath(path: string): { domain: string | null; version: string | null } {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { domain: null, version: null };

  const first = segments[0];
  // Parse @version: "api.cloudflare.com@v5" → { domain: "api.cloudflare.com", version: "v5" }
  const atIndex = first.indexOf("@");
  if (atIndex > 0) {
    return {
      domain: first.slice(0, atIndex),
      version: first.slice(atIndex + 1),
    };
  }

  return { domain: first, version: null };
}
