import { Hono } from "hono";
import { AgentFs } from "@nkmc/agent-fs";
import type { JWK } from "jose";
import type { RegistryStore } from "../registry/types.js";
import type { D1Database } from "../d1/types.js";
import type { CredentialVault } from "../credential/types.js";
import { createRegistryResolver } from "../registry/resolver.js";
import { Context7Backend } from "../registry/context7-backend.js";
import { adminAuth } from "./middleware/admin-auth.js";
import { publishOrAdminAuth } from "./middleware/publish-auth.js";
import { agentAuth } from "./middleware/agent-auth.js";
import { authRoutes } from "./routes/auth.js";
import { registryRoutes } from "./routes/registry.js";
import { domainRoutes } from "./routes/domains.js";
import { credentialRoutes } from "./routes/credentials.js";
import { byokRoutes } from "./routes/byok.js";
import { fsRoutes } from "./routes/fs.js";
import { proxyRoutes, type ExecResult } from "./routes/proxy.js";
import { peerRoutes } from "./routes/peers.js";
import { federationRoutes } from "./routes/federation.js";
import type { PeerStore } from "../federation/types.js";
import type { ToolRegistry } from "../proxy/tool-registry.js";
import type { TunnelStore, TunnelProvider } from "../tunnel/types.js";
import { tunnelRoutes } from "./routes/tunnels.js";

export type Env = {
  Variables: {
    agent: { id: string; roles: string[] };
  };
};

export interface GatewayOptions {
  store: RegistryStore;
  gatewayPrivateKey: JWK;
  gatewayPublicKey: JWK;
  adminToken: string;
  db?: D1Database;
  vault?: CredentialVault;
  context7ApiKey?: string;
  peerStore?: PeerStore;
  proxy?: {
    toolRegistry: ToolRegistry;
    exec: (tool: string, args: string[], env: Record<string, string>) => Promise<ExecResult>;
  };
  tunnel?: {
    store: TunnelStore;
    provider: TunnelProvider;
    domain: string;
  };
}

export function createGateway(options: GatewayOptions): Hono<Env> {
  const { store, gatewayPrivateKey, gatewayPublicKey, adminToken } = options;

  const app = new Hono<Env>();

  // Create registry resolver hooks for AgentFs
  const { onMiss, listDomains, searchDomains, searchEndpoints } = createRegistryResolver(
    options.vault
      ? { store, vault: options.vault, gatewayPrivateKey }
      : { store, gatewayPrivateKey },
  );

  // First-party mounts
  const mounts: { path: string; backend: import("@nkmc/agent-fs").FsBackend }[] = [];

  // Context7: built-in documentation query service
  if (options.context7ApiKey) {
    mounts.push({ path: "/context7", backend: new Context7Backend({ apiKey: options.context7ApiKey }) });
  }

  // Create AgentFs instance with registry hooks
  const agentFs = new AgentFs({
    mounts,
    onMiss,
    listDomains,
    searchDomains,
    searchEndpoints,
  });

  // Public: JWKS endpoint for developers to discover gateway public key
  app.get("/.well-known/jwks.json", (c) => {
    return c.json({ keys: [gatewayPublicKey] });
  });

  // Public: Auth token endpoint
  app.route("/auth", authRoutes({ privateKey: gatewayPrivateKey }));

  // Public: Domain claim / verify (only when db is provided)
  if (options.db) {
    app.route("/domains", domainRoutes({ db: options.db, gatewayPrivateKey }));
  }

  // Registry management (admin token or publish token)
  app.use("/registry/*", publishOrAdminAuth(adminToken, gatewayPublicKey));
  app.route("/registry", registryRoutes({ store }));

  // Admin: Credential management (optional — only mounted when vault is provided)
  if (options.vault) {
    app.use("/credentials/*", adminAuth(adminToken));
    app.route("/credentials", credentialRoutes({ vault: options.vault }));

    // Agent: BYOK credential management (JWT protected)
    app.use("/byok/*", agentAuth(gatewayPublicKey));
    app.route("/byok", byokRoutes({ vault: options.vault }));
  }

  // Agent: FS and execute routes (JWT protected, middleware first)
  app.use("/execute", agentAuth(gatewayPublicKey));
  app.use("/fs/*", agentAuth(gatewayPublicKey));
  app.route("/", fsRoutes({ agentFs }));

  // Proxy routes (optional — only mounted when proxy config and vault are provided)
  if (options.proxy && options.vault) {
    app.use("/proxy/*", agentAuth(gatewayPublicKey));
    app.route(
      "/proxy",
      proxyRoutes({
        vault: options.vault,
        toolRegistry: options.proxy.toolRegistry,
        exec: options.proxy.exec,
      }),
    );
  }

  // Federation routes (optional — only mounted when peerStore and vault are provided)
  if (options.peerStore && options.vault) {
    app.use("/admin/federation/*", adminAuth(adminToken));
    app.route("/admin/federation", peerRoutes({ peerStore: options.peerStore }));

    app.route("/federation", federationRoutes({
      peerStore: options.peerStore,
      vault: options.vault,
      agentFs,
    }));
  }

  // Tunnel routes (optional — only mounted when tunnel config is provided)
  if (options.tunnel) {
    app.use("/tunnels/*", agentAuth(gatewayPublicKey));
    app.route(
      "/tunnels",
      tunnelRoutes({
        tunnelStore: options.tunnel.store,
        tunnelProvider: options.tunnel.provider,
        tunnelDomain: options.tunnel.domain,
      }),
    );
  }

  return app;
}
