import { Hono } from "hono";
import type { Env } from "../app.js";
import type { CredentialVault } from "../../credential/types.js";
import type { ToolRegistry } from "../../proxy/tool-registry.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProxyRouteOptions {
  vault: CredentialVault;
  toolRegistry: ToolRegistry;
  exec: (tool: string, args: string[], env: Record<string, string>) => Promise<ExecResult>;
}

export function proxyRoutes(options: ProxyRouteOptions) {
  const { vault, toolRegistry, exec } = options;
  const app = new Hono<Env>();

  // POST /exec — Execute a CLI tool with injected credentials
  app.post("/exec", async (c) => {
    const body = await c.req.json<{ tool: string; args?: string[] }>();
    if (!body.tool || typeof body.tool !== "string") {
      return c.json({ error: "Missing 'tool' field" }, 400);
    }

    const toolDef = toolRegistry.get(body.tool);
    if (!toolDef) {
      return c.json({ error: `Unknown tool: ${body.tool}` }, 404);
    }

    const agent = c.get("agent");
    const credential = await vault.get(toolDef.credentialDomain, agent.id);
    if (!credential) {
      return c.json({ error: `No credential for domain: ${toolDef.credentialDomain}` }, 401);
    }

    const env = toolRegistry.buildEnv(toolDef, credential.auth);
    const args = body.args ?? [];
    const result = await exec(body.tool, args, env);

    return c.json(result);
  });

  // GET /tools — List available tools
  app.get("/tools", (c) => {
    const tools = toolRegistry.list().map((t) => ({
      name: t.name,
      credentialDomain: t.credentialDomain,
    }));
    return c.json({ tools });
  });

  return app;
}
