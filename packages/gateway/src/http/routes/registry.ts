import { Hono } from "hono";
import type { RegistryStore, EndpointRecord, SourceConfig } from "../../registry/types.js";
import { parseSkillMd } from "../../registry/skill-parser.js";
import { fetchAndCompile } from "../../registry/openapi-compiler.js";
import type { Env } from "../app.js";
import type { PublishAuthContext } from "../middleware/publish-auth.js";

/** Well-known paths to probe for OpenAPI specs */
const OPENAPI_PATHS = [
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/swagger.yaml",
  "/docs/openapi.json",
  "/api-docs",
  "/api/openapi.json",
  "/.well-known/openapi.json",
  "/.well-known/openapi.yaml",
];

export interface RegistryRouteOptions {
  store: RegistryStore;
}

export function registryRoutes(options: RegistryRouteOptions) {
  const { store } = options;
  const app = new Hono<Env>();

  // Register a service (body = skill.md content)
  app.post("/services", async (c) => {
    const domain = c.req.query("domain");
    if (!domain) {
      return c.json({ error: "Missing ?domain= query parameter" }, 400);
    }

    // Publish token scope check: token must match the target domain
    const auth = c.get("publishAuth" as never) as PublishAuthContext | undefined;
    if (auth?.type === "publish" && auth.domain !== domain) {
      return c.json(
        { error: `Token is scoped to "${auth.domain}", cannot register "${domain}"` },
        403,
      );
    }

    const contentType = c.req.header("Content-Type") ?? "";
    let skillMd: string;

    if (contentType.includes("text/markdown") || contentType.includes("text/plain")) {
      skillMd = await c.req.text();
    } else {
      // Try JSON body with skillMd field (and optional pre-compiled endpoints)
      const body = await c.req.json<{ skillMd: string; endpoints?: EndpointRecord[]; source?: SourceConfig }>().catch(() => null);
      if (!body?.skillMd) {
        return c.json({ error: "Body must be skill.md text or JSON with skillMd field" }, 400);
      }
      skillMd = body.skillMd;
      // If pre-compiled endpoints are provided, use them after parsing
      if (Array.isArray(body.endpoints) && body.endpoints.length > 0) {
        if (!skillMd.trim()) {
          return c.json({ error: "Empty skill.md content" }, 400);
        }
        const isFirstParty = c.req.query("first_party") === "true";
        const authMode = c.req.query("auth_mode");
        const record = parseSkillMd(domain, skillMd, { isFirstParty });
        record.endpoints = body.endpoints;
        if (body.source) {
          record.source = body.source;
        }
        if (authMode === "nkmc-jwt") {
          record.authMode = "nkmc-jwt";
        }
        await store.put(domain, record);
        return c.json({ ok: true, domain, name: record.name }, 201);
      }
    }

    if (!skillMd.trim()) {
      return c.json({ error: "Empty skill.md content" }, 400);
    }

    const isFirstParty = c.req.query("first_party") === "true";
    const authMode = c.req.query("auth_mode");
    const record = parseSkillMd(domain, skillMd, { isFirstParty });
    if (authMode === "nkmc-jwt") {
      record.authMode = "nkmc-jwt";
    }
    await store.put(domain, record);

    return c.json({ ok: true, domain, name: record.name }, 201);
  });

  // Discover: auto-detect OpenAPI spec from a running service URL and register
  app.post("/services/discover", async (c) => {
    const body = await c.req.json<{ url: string; domain?: string; specUrl?: string }>().catch(() => null);
    if (!body?.url) {
      return c.json({ error: "Missing 'url' field (base URL of the service)" }, 400);
    }

    const baseUrl = body.url.replace(/\/+$/, "");

    // Derive domain from URL if not provided
    let domain: string;
    try {
      domain = body.domain ?? new URL(baseUrl).hostname;
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }

    // Publish token scope check
    const auth = c.get("publishAuth" as never) as PublishAuthContext | undefined;
    if (auth?.type === "publish" && auth.domain !== domain) {
      return c.json(
        { error: `Token is scoped to "${auth.domain}", cannot register "${domain}"` },
        403,
      );
    }

    // If specUrl is provided, use it directly
    if (body.specUrl) {
      try {
        const result = await fetchAndCompile(body.specUrl, { domain });
        await store.put(domain, result.record);
        return c.json({
          ok: true,
          domain,
          name: result.record.name,
          endpoints: result.record.endpoints.length,
          source: body.specUrl,
        }, 201);
      } catch (err) {
        return c.json({ error: `Failed to compile spec: ${err instanceof Error ? err.message : err}` }, 400);
      }
    }

    // Auto-discover: probe well-known paths
    for (const path of OPENAPI_PATHS) {
      const specUrl = `${baseUrl}${path}`;
      try {
        const resp = await fetch(specUrl, { method: "GET", headers: { Accept: "application/json, application/yaml" } });
        if (!resp.ok) continue;

        const text = await resp.text();
        if (!text.trim() || text.length < 20) continue;

        // Try to compile — if it fails, try next path
        try {
          const result = await fetchAndCompile(specUrl, { domain });
          await store.put(domain, result.record);
          return c.json({
            ok: true,
            domain,
            name: result.record.name,
            endpoints: result.record.endpoints.length,
            source: specUrl,
          }, 201);
        } catch {
          continue;
        }
      } catch {
        continue;
      }
    }

    return c.json({
      error: "Could not find OpenAPI spec",
      probed: OPENAPI_PATHS.map((p) => `${baseUrl}${p}`),
      hint: "Use --spec-url to provide the spec location directly",
    }, 404);
  });

  // List all services
  app.get("/services", async (c) => {
    const query = c.req.query("q");
    if (query) {
      const results = await store.search(query);
      return c.json(results);
    }
    const list = await store.list();
    return c.json(list);
  });

  // Get service details
  app.get("/services/:domain", async (c) => {
    const domain = c.req.param("domain");
    const record = await store.get(domain);
    if (!record) {
      return c.json({ error: "Service not found" }, 404);
    }
    return c.json(record);
  });

  // List versions of a service
  app.get("/services/:domain/versions", async (c) => {
    const domain = c.req.param("domain");
    const versions = await store.listVersions(domain);
    return c.json({ domain, versions });
  });

  // Get specific version of a service
  app.get("/services/:domain/versions/:version", async (c) => {
    const domain = c.req.param("domain");
    const version = c.req.param("version");
    const record = await store.getVersion(domain, version);
    if (!record) {
      return c.json({ error: "Version not found" }, 404);
    }
    return c.json(record);
  });

  // Delete a service
  app.delete("/services/:domain", async (c) => {
    const domain = c.req.param("domain");
    const existing = await store.get(domain);
    if (!existing) {
      return c.json({ error: "Service not found" }, 404);
    }
    await store.delete(domain);
    return c.json({ ok: true, domain });
  });

  return app;
}
