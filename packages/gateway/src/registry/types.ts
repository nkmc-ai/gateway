// packages/gateway/src/registry/types.ts

export type ServiceStatus = "active" | "deprecated" | "sunset";

export interface EndpointPricing {
  cost: number;
  currency: string;
  per: "call" | "byte" | "minute";
}

export interface EndpointAnnotations {
  rateLimit?: number;
  cacheTtl?: number;
  tags?: string[];
}

export interface EndpointParam {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  type: string;
  description?: string;
}

export interface SchemaProperty {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface EndpointRecord {
  method: string;
  path: string;
  description: string;
  price?: string;
  pricing?: EndpointPricing;
  annotations?: EndpointAnnotations;
  parameters?: EndpointParam[];
  requestBody?: {
    contentType: string;
    required: boolean;
    properties: SchemaProperty[];
  };
  responses?: {
    status: number;
    description: string;
    properties?: SchemaProperty[];
  }[];
}

/** @deprecated Use EndpointRecord instead */
export type EndpointSummary = EndpointRecord;

export interface RpcSourceMeta {
  rpcUrl: string;
  convention: "crud" | "evm" | "raw";
  resources: Array<{
    name: string;
    idField?: string;
    methods: Record<string, string>; // fsOp → rpcMethod
  }>;
}

export interface SourceConfig {
  type: "skillmd" | "openapi" | "wellknown" | "jsonrpc";
  url?: string;
  basePath?: string;
  refreshInterval?: number;
  lastRefresh?: number;
  rpc?: RpcSourceMeta;
}

export interface ServiceRecord {
  domain: string;
  name: string;
  description: string;
  version: string;
  roles: string[];
  skillMd: string;
  endpoints: EndpointRecord[];
  isFirstParty: boolean;
  createdAt: number;
  updatedAt: number;
  status: ServiceStatus;
  isDefault: boolean;
  sunsetDate?: number;
  source?: SourceConfig;
  authMode?: "nkmc-jwt";
}

export interface ServiceSummary {
  domain: string;
  name: string;
  description: string;
  isFirstParty: boolean;
}

export interface SearchResult {
  domain: string;
  name: string;
  description: string;
  isFirstParty: boolean;
  matchedEndpoints: Pick<EndpointRecord, "method" | "path" | "description">[];
}

export interface VersionSummary {
  version: string;
  status: ServiceStatus;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RegistryStats {
  serviceCount: number;
  endpointCount: number;
}

export interface RegistryStore {
  get(domain: string): Promise<ServiceRecord | null>;
  getVersion(domain: string, version: string): Promise<ServiceRecord | null>;
  listVersions(domain: string): Promise<VersionSummary[]>;
  put(domain: string, record: ServiceRecord): Promise<void>;
  delete(domain: string): Promise<void>;
  list(): Promise<ServiceSummary[]>;
  search(query: string): Promise<SearchResult[]>;
  stats?(): Promise<RegistryStats>;
}
