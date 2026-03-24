// packages/gateway/src/registry/rpc-compiler.ts

import type { RpcManifestDef } from "../onboard/types.js";
import type { ServiceRecord, EndpointRecord, RpcSourceMeta } from "./types.js";

export interface RpcCompileResult {
  record: ServiceRecord;
  skillMd: string;
}

/**
 * Compile an RpcManifestDef into a ServiceRecord suitable for the registry.
 *
 * Each RPC method becomes an EndpointRecord with method="RPC" and path=rpcMethod.
 * Resources are inferred from the method prefix (e.g. "eth_getBalance" → "balances")
 * or from explicit `resource` annotations on each method.
 */
export function compileRpcDef(
  domain: string,
  rpcDef: RpcManifestDef,
  options?: { version?: string; isFirstParty?: boolean },
): RpcCompileResult {
  const convention = rpcDef.convention ?? "raw";

  // Build endpoints
  const endpoints: EndpointRecord[] = rpcDef.methods.map((m) => ({
    method: "RPC",
    path: m.rpcMethod,
    description: m.description,
  }));

  // Group methods by resource for SourceConfig
  const resourceMap = new Map<string, { name: string; idField?: string; methods: Record<string, string> }>();

  for (const m of rpcDef.methods) {
    const resName = m.resource ?? inferResource(m.rpcMethod);
    if (!resourceMap.has(resName)) {
      resourceMap.set(resName, { name: resName, methods: {} });
    }
    const entry = resourceMap.get(resName)!;
    if (m.fsOp) {
      entry.methods[m.fsOp] = m.rpcMethod;
    }
  }

  const rpcMeta: RpcSourceMeta = {
    rpcUrl: rpcDef.url,
    convention,
    resources: Array.from(resourceMap.values()),
  };

  // Generate skill.md
  const skillMd = generateSkillMd(domain, rpcDef, endpoints);

  const now = Date.now();
  const record: ServiceRecord = {
    domain,
    name: domain,
    description: `JSON-RPC service at ${domain}`,
    version: options?.version ?? "1.0",
    roles: ["agent"],
    skillMd,
    endpoints,
    isFirstParty: options?.isFirstParty ?? false,
    createdAt: now,
    updatedAt: now,
    status: "active",
    isDefault: true,
    source: {
      type: "jsonrpc",
      url: rpcDef.url,
      rpc: rpcMeta,
    },
  };

  return { record, skillMd };
}

/**
 * Infer a resource name from an RPC method name.
 * e.g. "eth_getBlockByNumber" → "blocks"
 *      "eth_getBalance" → "balances"
 *      "net_version" → "net"
 */
function inferResource(rpcMethod: string): string {
  // Split by underscore: "eth_getBlockByNumber" → ["eth", "getBlockByNumber"]
  const underscoreIdx = rpcMethod.indexOf("_");
  if (underscoreIdx < 0) return rpcMethod;

  const action = rpcMethod.slice(underscoreIdx + 1);

  // Strip common verb prefixes
  const verbPrefixes = ["get", "send", "subscribe", "unsubscribe", "new", "call"];
  let noun = action;
  for (const prefix of verbPrefixes) {
    if (action.startsWith(prefix) && action.length > prefix.length) {
      noun = action.slice(prefix.length);
      break;
    }
  }

  // Split camelCase on first capital to get the noun: "BlockByNumber" → "Block"
  const camelMatch = noun.match(/^([A-Z][a-z]+)/);
  if (camelMatch) {
    noun = camelMatch[1];
  }

  // Pluralize naive: add 's' if not already ending in 's'
  const lower = noun.toLowerCase();
  return lower.endsWith("s") ? lower : lower + "s";
}

function generateSkillMd(
  domain: string,
  rpcDef: RpcManifestDef,
  endpoints: EndpointRecord[],
): string {
  const lines: string[] = [
    "---",
    `name: "${domain}"`,
    `version: "1.0"`,
    `roles: [agent]`,
    "---",
    "",
    `# ${domain}`,
    "",
    `JSON-RPC service at ${rpcDef.url}`,
    "",
    `Convention: ${rpcDef.convention ?? "raw"}`,
    "",
    "## RPC Methods",
    "",
    "| method | description |",
    "|--------|-------------|",
  ];

  for (const ep of endpoints) {
    lines.push(`| ${ep.path} | ${ep.description} |`);
  }

  return lines.join("\n");
}
