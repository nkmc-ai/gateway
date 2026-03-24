import YAML from "yaml";
import type { ServiceRecord, EndpointRecord, EndpointPricing, EndpointParam, SchemaProperty } from "./types.js";
import type { HttpResource } from "@nkmc/agent-fs";

export interface CompileOptions {
  domain: string;
  version?: string;
  isFirstParty?: boolean;
}

export interface CompileResult {
  record: ServiceRecord;
  resources: HttpResource[];
  skillMd: string;
}

/** Extract basePath from OpenAPI servers[0].url (e.g. "/client/v4" from "https://api.cloudflare.com/client/v4") */
export function extractBasePath(spec: any): string {
  const servers = spec.servers;
  if (!Array.isArray(servers) || servers.length === 0) return "";
  const serverUrl = servers[0]?.url;
  if (!serverUrl || typeof serverUrl !== "string") return "";
  try {
    // Handle relative URLs
    if (serverUrl.startsWith("/")) {
      return serverUrl.replace(/\/+$/, "");
    }
    const parsed = new URL(serverUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return pathname || "";
  } catch {
    return "";
  }
}

/** Resolve a $ref pointer like "#/components/schemas/Pet" */
function resolveRef(spec: any, ref: string): any {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let current = spec;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

/** Resolve a schema, following $ref if present (one level only) */
function resolveSchema(spec: any, schema: any): any {
  if (!schema) return undefined;
  if (schema.$ref) return resolveRef(spec, schema.$ref);
  return schema;
}

/** Extract top-level properties from a JSON Schema object */
function extractProperties(spec: any, schema: any): SchemaProperty[] {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || resolved.type !== "object" || !resolved.properties) return [];
  const requiredSet = new Set<string>(resolved.required ?? []);
  const props: SchemaProperty[] = [];
  for (const [name, prop] of Object.entries(resolved.properties as Record<string, any>)) {
    const p = resolveSchema(spec, prop) ?? prop;
    props.push({
      name,
      type: p.type ?? (p.enum ? "enum" : "unknown"),
      required: requiredSet.has(name),
      ...(p.description ? { description: p.description } : {}),
    });
  }
  return props;
}

/** Extract parameters from an OpenAPI operation */
function extractParams(spec: any, operation: any): EndpointParam[] | undefined {
  const params = operation.parameters;
  if (!Array.isArray(params) || params.length === 0) return undefined;
  const result: EndpointParam[] = [];
  for (const raw of params) {
    const p = resolveSchema(spec, raw) ?? raw;
    if (!p.name || !p.in) continue;
    if (!["path", "query", "header"].includes(p.in)) continue;
    const schema = resolveSchema(spec, p.schema) ?? p.schema;
    result.push({
      name: p.name,
      in: p.in as "path" | "query" | "header",
      required: !!p.required,
      type: schema?.type ?? "string",
      ...(p.description ? { description: p.description } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

/** Extract requestBody from an OpenAPI operation */
function extractRequestBody(spec: any, operation: any): EndpointRecord["requestBody"] {
  const body = resolveSchema(spec, operation.requestBody);
  if (!body?.content) return undefined;
  const jsonContent = body.content["application/json"];
  if (!jsonContent?.schema) return undefined;
  const properties = extractProperties(spec, jsonContent.schema);
  if (properties.length === 0) return undefined;
  return {
    contentType: "application/json",
    required: !!body.required,
    properties,
  };
}

/** Extract 2xx responses from an OpenAPI operation */
function extractResponses(spec: any, operation: any): EndpointRecord["responses"] {
  const responses = operation.responses;
  if (!responses || typeof responses !== "object") return undefined;
  const result: NonNullable<EndpointRecord["responses"]> = [];
  for (const [code, raw] of Object.entries(responses as Record<string, any>)) {
    const status = parseInt(code, 10);
    if (isNaN(status) || status < 200 || status >= 300) continue;
    const resp = resolveSchema(spec, raw) ?? raw;
    const jsonContent = resp?.content?.["application/json"];
    const properties = jsonContent?.schema ? extractProperties(spec, jsonContent.schema) : undefined;
    result.push({
      status,
      description: resp?.description ?? "",
      ...(properties && properties.length > 0 ? { properties } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

// Compile an OpenAPI spec (parsed JSON object) into a ServiceRecord + HttpResources
export function compileOpenApiSpec(spec: any, options: CompileOptions): CompileResult {
  const info = spec.info ?? {};
  const name = info.title ?? options.domain;
  const description = info.description ?? "";
  const version = options.version ?? info.version ?? "1.0";
  const basePath = extractBasePath(spec);

  const endpoints: EndpointRecord[] = [];
  const resources: HttpResource[] = [];
  const resourcePaths = new Map<string, HttpResource>();

  // Extract endpoints from paths
  const paths = spec.paths ?? {};
  for (const [path, methods] of Object.entries(paths)) {
    if (typeof methods !== "object" || methods === null) continue;
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const operation = op as any;
      const parameters = extractParams(spec, operation);
      const requestBody = extractRequestBody(spec, operation);
      const responses = extractResponses(spec, operation);
      endpoints.push({
        method: method.toUpperCase(),
        path,
        description: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`,
        ...(parameters ? { parameters } : {}),
        ...(requestBody ? { requestBody } : {}),
        ...(responses ? { responses } : {}),
      });
    }

    // Infer resources from path patterns like /resources or /resources/{id}
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 1) {
      const resourceName = segments[0];
      if (!resourcePaths.has(resourceName) && !resourceName.startsWith("{")) {
        resourcePaths.set(resourceName, {
          name: resourceName,
          apiPath: `/${resourceName}`,
        });
      }
    }
  }

  for (const r of resourcePaths.values()) {
    resources.push(r);
  }

  // Generate skill.md
  const skillMd = generateSkillMd(name, version, description, endpoints, resources);

  const now = Date.now();
  const record: ServiceRecord = {
    domain: options.domain,
    name,
    description,
    version,
    roles: ["agent"],
    skillMd,
    endpoints,
    isFirstParty: options.isFirstParty ?? false,
    createdAt: now,
    updatedAt: now,
    status: "active",
    isDefault: true,
    source: { type: "openapi", ...(basePath ? { basePath } : {}) },
  };

  return { record, resources, skillMd };
}

// Fetch a remote OpenAPI spec and compile
export async function fetchAndCompile(
  specUrl: string,
  options: CompileOptions,
  fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<CompileResult> {
  const resp = await fetchFn(specUrl);
  if (!resp.ok) throw new Error(`Failed to fetch spec: ${resp.status} ${resp.statusText}`);
  const text = await resp.text();
  const spec = parseSpec(specUrl, resp.headers.get("content-type") ?? "", text);
  const result = compileOpenApiSpec(spec, options);
  const basePath = result.record.source?.basePath;
  result.record.source = { type: "openapi", url: specUrl, ...(basePath ? { basePath } : {}) };
  return result;
}

/** Detect format from content-type or URL extension and parse accordingly */
function parseSpec(url: string, contentType: string, text: string): any {
  const isJson =
    contentType.includes("json") ||
    url.endsWith(".json") ||
    text.trimStart().startsWith("{");
  if (isJson) return JSON.parse(text);
  return YAML.parse(text);
}

function propsTable(props: SchemaProperty[]): string {
  let t = "| name | type | required |\n|------|------|----------|\n";
  for (const p of props) {
    t += `| ${p.name} | ${p.type} | ${p.required ? "*" : ""} |\n`;
  }
  return t;
}

function generateSkillMd(
  name: string,
  version: string,
  description: string,
  endpoints: EndpointRecord[],
  resources: HttpResource[],
): string {
  let md = `---\nname: "${name}"\ngateway: nkmc\nversion: "${version}"\nroles: [agent]\n---\n\n`;
  md += `# ${name}\n\n${description}\n\n`;
  if (resources.length > 0) {
    md += `## Schema\n\n`;
    for (const r of resources) {
      md += `### ${r.name} (public)\n\n`;
    }
  }
  if (endpoints.length > 0) {
    md += `## API\n\n`;
    for (const ep of endpoints) {
      md += `### ${ep.description}\n\n`;
      md += `\`${ep.method} ${ep.path}\`\n\n`;

      if (ep.parameters && ep.parameters.length > 0) {
        md += "**Parameters:**\n\n";
        md += "| name | in | type | required |\n|------|-----|------|----------|\n";
        for (const p of ep.parameters) {
          md += `| ${p.name} | ${p.in} | ${p.type} | ${p.required ? "*" : ""} |\n`;
        }
        md += "\n";
      }

      if (ep.requestBody) {
        const req = ep.requestBody;
        md += `**Body** (${req.contentType}${req.required ? ", required" : ""}):\n\n`;
        md += propsTable(req.properties);
        md += "\n";
      }

      if (ep.responses && ep.responses.length > 0) {
        for (const r of ep.responses) {
          md += `**Response ${r.status}**${r.description ? `: ${r.description}` : ""}\n\n`;
          if (r.properties && r.properties.length > 0) {
            md += propsTable(r.properties);
            md += "\n";
          }
        }
      }
    }
  }
  return md;
}
