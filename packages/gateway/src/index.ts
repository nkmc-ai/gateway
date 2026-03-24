export const VERSION = "0.1.0";

export type {
  EndpointSummary,
  EndpointRecord,
  EndpointPricing,
  EndpointAnnotations,
  ServiceRecord,
  SearchResult,
  ServiceSummary,
  ServiceStatus,
  VersionSummary,
  SourceConfig,
  RegistryStore,
} from "./registry/types.js";

export { MemoryRegistryStore } from "./registry/memory-store.js";
export { D1RegistryStore } from "./registry/d1-store.js";
export { parseSkillMd, parsePricingAnnotation, type ParseOptions } from "./registry/skill-parser.js";
export { skillToHttpConfig } from "./registry/skill-to-config.js";
export {
  createRegistryResolver,
  extractDomainPath,
  type RegistryResolverHooks,
  type RegistryResolverOptions,
} from "./registry/resolver.js";

export type { MeterRecord, MeterQuery, MeterStore } from "./metering/types.js";
export { MemoryMeterStore } from "./metering/memory-store.js";
export { D1MeterStore } from "./metering/d1-store.js";
export { lookupPricing, checkAccess, meter } from "./metering/pricing-guard.js";
export { VirtualFileBackend } from "./registry/virtual-files.js";

export type { StoredCredential, CredentialVault } from "./credential/types.js";
export { MemoryCredentialVault } from "./credential/memory-vault.js";
export { D1CredentialVault } from "./credential/d1-vault.js";
export { credentialRoutes } from "./http/routes/credentials.js";

export { queryDnsTxt } from "./http/lib/dns.js";
export { Context7Client, type Context7Options, type LibrarySearchResult } from "./registry/context7.js";
export { Context7Backend, type Context7BackendOptions } from "./registry/context7-backend.js";

export {
  OnboardPipeline,
  discoverFromApisGuru,
  type PipelineOptions,
  type ApisGuruOptions,
  type ManifestEntry,
  type ManifestAuth,
  type OnboardResult,
  type OnboardReport,
} from "./onboard/index.js";

export type { D1Database, D1PreparedStatement, D1Result, D1RunResult } from "./d1/types.js";
export { createSqliteD1 } from "./d1/sqlite-adapter.js";

export type { PeerGateway, LendingRule, PeerStore } from "./federation/types.js";
export { D1PeerStore } from "./federation/d1-peer-store.js";

export type { TunnelRecord, TunnelStore, TunnelProvider } from "./tunnel/types.js";
export { MemoryTunnelStore } from "./tunnel/memory-store.js";
export { CloudflareTunnelProvider } from "./tunnel/cloudflare-provider.js";
export { tunnelRoutes, type TunnelRouteOptions } from "./http/routes/tunnels.js";
