import { Hono } from "hono";
import type { AgentFs, FsOp } from "@nkmc/agent-fs";
import type { Env } from "../app.js";

export interface FsRouteOptions {
  agentFs: AgentFs;
}

function errorToStatus(code: string): number {
  switch (code) {
    case "PARSE_ERROR":
    case "INVALID_PATH":
      return 400;
    case "PERMISSION_DENIED":
      return 403;
    case "NOT_FOUND":
    case "NO_MOUNT":
      return 404;
    default:
      return 500;
  }
}

export function fsRoutes(options: FsRouteOptions) {
  const { agentFs } = options;
  const app = new Hono<Env>();

  // POST /execute — raw command execution
  app.post("/execute", async (c) => {
    const body = await c.req.json<{ command: string; roles?: string[] }>();
    if (!body.command || typeof body.command !== "string") {
      return c.json({ error: "Missing 'command' field" }, 400);
    }

    const agent = c.get("agent");
    const roles = body.roles ?? agent?.roles;
    const result = await agentFs.execute(body.command, roles, agent);
    const status = result.ok ? 200 : errorToStatus(result.error.code);

    return c.json(result, status as 200);
  });

  // /fs/* — REST-style access
  app.all("/fs/*", async (c) => {
    const fullPath = c.req.path;
    const virtualPath = fullPath.slice(fullPath.indexOf("/fs") + 3) || "/";
    const query = c.req.query("q");
    const agent = c.get("agent");
    const roles = agent?.roles;

    let op: FsOp;
    let data: unknown | undefined;
    let pattern: string | undefined;

    switch (c.req.method) {
      case "GET":
        if (query) {
          op = "grep";
          pattern = query;
        } else if (virtualPath.endsWith("/")) {
          op = "ls";
        } else {
          op = "cat";
        }
        break;
      case "POST":
      case "PUT":
        op = "write";
        data = await c.req.json();
        break;
      case "DELETE":
        op = "rm";
        break;
      default:
        return c.json({ error: "Method not allowed" }, 405);
    }

    const result = await agentFs.executeCommand(
      { op, path: virtualPath, data, pattern },
      roles,
      agent,
    );
    const status = result.ok ? 200 : errorToStatus(result.error.code);

    return c.json(result, status as 200);
  });

  return app;
}
