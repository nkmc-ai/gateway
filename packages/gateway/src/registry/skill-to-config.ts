// packages/gateway/src/registry/skill-to-config.ts
import type { HttpBackendConfig, HttpResource, HttpEndpoint, RpcResource, RpcMethod, RpcCallContext } from "@nkmc/agent-fs";
import type { ServiceRecord, RpcSourceMeta } from "./types.js";

export function skillToHttpConfig(record: ServiceRecord): HttpBackendConfig {
  let baseUrl = `https://${record.domain}`;
  if (record.source?.basePath) {
    baseUrl += record.source.basePath;
  }
  const resources = extractResources(record.skillMd);
  const endpoints = extractHttpEndpoints(record.skillMd);

  return {
    baseUrl,
    resources,
    endpoints,
  };
}

function extractResources(skillMd: string): HttpResource[] {
  const resources: HttpResource[] = [];
  const lines = skillMd.split("\n");

  let inSchema = false;
  let current: {
    name: string;
    fields: { name: string; type: string; description: string }[];
  } | null = null;

  for (const line of lines) {
    if (line.startsWith("## Schema")) {
      inSchema = true;
      continue;
    }
    if (inSchema && line.startsWith("## ") && !line.startsWith("## Schema")) {
      break;
    }
    if (!inSchema) continue;

    const tableMatch = line.match(/^### (\w+)\s/);
    if (tableMatch) {
      if (current) resources.push(toHttpResource(current));
      current = { name: tableMatch[1], fields: [] };
      continue;
    }

    if (current && line.startsWith("|") && !line.startsWith("|--") && !line.startsWith("| field")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 3) {
        current.fields.push({
          name: cells[0],
          type: cells[1],
          description: cells[2],
        });
      }
    }
  }

  if (current) resources.push(toHttpResource(current));
  return resources;
}

function toHttpResource(parsed: {
  name: string;
  fields: { name: string; type: string; description: string }[];
}): HttpResource {
  return {
    name: parsed.name,
    apiPath: `/${parsed.name}`,
    fields: parsed.fields,
  };
}

function extractHttpEndpoints(skillMd: string): HttpEndpoint[] {
  const endpoints: HttpEndpoint[] = [];
  const lines = skillMd.split("\n");

  let inApi = false;
  let currentHeading: string | null = null;

  for (const line of lines) {
    if (line.startsWith("## API")) {
      inApi = true;
      continue;
    }
    if (inApi && line.startsWith("## ") && !line.startsWith("## API")) {
      break;
    }
    if (!inApi) continue;

    if (line.startsWith("### ")) {
      currentHeading = line.slice(4).trim();
      continue;
    }

    const match = line.match(/^`(GET|POST|PUT|PATCH|DELETE)\s+(\S+)`/);
    if (match && currentHeading) {
      const slug = currentHeading.toLowerCase().replace(/\s+/g, "-");
      endpoints.push({
        name: slug,
        method: match[1] as HttpEndpoint["method"],
        apiPath: match[2],
        description: currentHeading,
      });
      currentHeading = null;
    }
  }

  return endpoints;
}

// --- RPC config factory ---

export interface RpcConfigResult {
  resources: RpcResource[];
}

/**
 * Rebuild RpcResource[] from the serializable RpcSourceMeta stored in the DB.
 * The `params` callbacks are recreated based on the convention mode.
 */
export function skillToRpcConfig(meta: RpcSourceMeta): RpcConfigResult {
  const resources: RpcResource[] = meta.resources.map((r) => {
    const methods: RpcResource["methods"] = {};
    const builder = getParamsBuilder(meta.convention);

    for (const [fsOp, rpcMethod] of Object.entries(r.methods)) {
      const key = fsOp as keyof RpcResource["methods"];
      methods[key] = {
        method: rpcMethod,
        params: builder(key),
      };
    }

    const resource: RpcResource = {
      name: r.name,
      ...(r.idField ? { idField: r.idField } : {}),
      methods,
    };

    // Add transforms for evm convention
    if (meta.convention === "evm") {
      resource.transform = buildEvmTransforms(r.name);
    }

    return resource;
  });

  return { resources };
}

type ParamsBuilder = (fsOp: keyof RpcResource["methods"]) => RpcMethod["params"];

function getParamsBuilder(convention: RpcSourceMeta["convention"]): ParamsBuilder {
  switch (convention) {
    case "crud":
      return crudParamsBuilder;
    case "evm":
      return evmParamsBuilder;
    case "raw":
    default:
      return rawParamsBuilder;
  }
}

/** Raw convention: pass-through — no params transformation */
function rawParamsBuilder(_fsOp: keyof RpcResource["methods"]): RpcMethod["params"] {
  return (ctx: RpcCallContext) => {
    if (ctx.data !== undefined) return [ctx.data];
    if (ctx.id !== undefined) return [ctx.id];
    return [];
  };
}

/** CRUD convention: standard CRUD parameter mapping */
function crudParamsBuilder(fsOp: keyof RpcResource["methods"]): RpcMethod["params"] {
  switch (fsOp) {
    case "list":
      return () => [];
    case "read":
      return (ctx: RpcCallContext) => [ctx.id!];
    case "write":
      return (ctx: RpcCallContext) => [ctx.id!, ctx.data];
    case "create":
      return (ctx: RpcCallContext) => [ctx.data];
    case "remove":
      return (ctx: RpcCallContext) => [ctx.id!];
    case "search":
      return (ctx: RpcCallContext) => [ctx.pattern!];
    default:
      return () => [];
  }
}

/** EVM convention: hex encoding and EVM-specific parameter patterns */
function evmParamsBuilder(fsOp: keyof RpcResource["methods"]): RpcMethod["params"] {
  switch (fsOp) {
    case "list":
      return () => [];
    case "read":
      return (ctx: RpcCallContext) => {
        const id = ctx.id!;
        // If it looks like a number, convert to hex
        const hexId = /^\d+$/.test(id) ? "0x" + Number(id).toString(16) : id;
        // Second param: "latest" for address-based methods (balance, nonce, code),
        // false for block/tx methods. "latest" is safe for both — providers that
        // expect a boolean will coerce the truthy string, and address-based
        // methods use it as a block tag.
        return [hexId, "latest"];
      };
    default:
      return rawParamsBuilder(fsOp);
  }
}

function buildEvmTransforms(resourceName: string): RpcResource["transform"] {
  const transform: RpcResource["transform"] = {};

  if (resourceName === "blocks") {
    // eth_blockNumber returns a hex string like "0x1234abc"
    // Convert to a list of recent block numbers as .json files
    transform.list = (data: unknown) => {
      const hex = String(data);
      const latest = parseInt(hex, 16);
      if (isNaN(latest)) return [];
      return Array.from({ length: 10 }, (_, i) => `${latest - i}.json`);
    };
  }

  if (resourceName === "balances") {
    transform.read = (data: unknown) => {
      // Convert wei hex to a readable object
      const hex = String(data);
      return { wei: hex, raw: hex };
    };
  }

  return Object.keys(transform).length > 0 ? transform : undefined;
}
