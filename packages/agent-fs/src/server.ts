import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentFs } from "./agent-fs.js";
import type { FsOp } from "./types.js";

export interface ServerOptions {
  agentFs: AgentFs;
  port?: number;
}

/**
 * HTTP server that exposes the AgentFs as a REST API.
 *
 * Route mapping:
 *   GET    /fs/*         → ls (if path ends with /) or cat
 *   GET    /fs/*?q=xxx   → grep
 *   POST   /fs/*         → write
 *   PUT    /fs/*         → write
 *   DELETE /fs/*         → rm
 *
 * Also accepts raw command strings via:
 *   POST /execute  body: { command: "ls /db/users/" }
 */
export function createAgentFsServer(options: ServerOptions) {
  const { agentFs, port = 3071 } = options;

  const server = createServer(async (req, res) => {
    try {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // POST /execute — raw command execution
      if (url.pathname === "/execute" && req.method === "POST") {
        const body = await readBody(req);
        const { command, roles } = body as { command: string; roles?: string[] };

        if (!command || typeof command !== "string") {
          sendJson(res, 400, { error: "Missing 'command' field" });
          return;
        }

        const result = await agentFs.execute(command, roles);
        const status = result.ok ? 200 : errorToStatus(result.error.code);
        sendJson(res, status, result);
        return;
      }

      // /fs/* — REST-style access
      if (url.pathname.startsWith("/fs")) {
        const virtualPath = url.pathname.slice(3) || "/"; // Remove "/fs" prefix
        const query = url.searchParams.get("q");

        let op: FsOp;
        let data: unknown | undefined;
        let pattern: string | undefined;

        switch (req.method) {
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
            data = await readBody(req);
            break;
          case "DELETE":
            op = "rm";
            break;
          default:
            sendJson(res, 405, { error: "Method not allowed" });
            return;
        }

        const result = await agentFs.executeCommand(
          { op, path: virtualPath, data, pattern },
        );
        const status = result.ok ? 200 : errorToStatus(result.error.code);
        sendJson(res, status, result);
        return;
      }

      sendJson(res, 404, { error: "Not found. Use /fs/* or /execute" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Internal server error",
      });
    }
  });

  return {
    server,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(port, () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    port,
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
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
