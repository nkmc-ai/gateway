export const VERSION = "0.1.0";

export type {
  FsOp,
  FsCommand,
  FsResult,
  FsError,
  FsBackend,
  Mount,
  AccessRole,
  AgentContext,
} from "./types.js";

export { parseCommand } from "./parser.js";
export { MountResolver, type ResolvedMount } from "./mount.js";
export { AgentFs, type AgentFsOptions } from "./agent-fs.js";
export { createAgentFsServer, type ServerOptions } from "./server.js";
export {
  HttpBackend,
  type HttpBackendConfig,
  type HttpAuth,
  type HttpResource,
  type HttpEndpoint,
  type PaginationConfig,
} from "./backends/http.js";
export {
  RpcBackend,
  JsonRpcTransport,
  RpcError,
  type RpcBackendConfig,
  type RpcTransport,
  type RpcResource,
  type RpcMethod,
  type RpcCallContext,
  type JsonRpcTransportConfig,
} from "./backends/rpc.js";
