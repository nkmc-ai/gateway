import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpBackend } from "../src/backends/http.js";

describe("HttpBackend OAuth2 client_credentials", () => {
  let server: Server;
  let port: number;
  let tokenRequestCount: number;

  beforeAll(async () => {
    tokenRequestCount = 0;

    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");

        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = chunks.length ? Buffer.concat(chunks).toString() : "";

          // Token endpoint
          if (req.url === "/oauth/token" && req.method === "POST") {
            tokenRequestCount++;

            // Verify client credentials in Authorization header
            const auth = req.headers.authorization;
            if (!auth?.startsWith("Basic ")) {
              res.writeHead(401);
              res.end(JSON.stringify({ error: "invalid_client" }));
              return;
            }

            const decoded = Buffer.from(auth.slice(6), "base64").toString();
            const [clientId, clientSecret] = decoded.split(":");
            if (clientId !== "my-client" || clientSecret !== "my-secret") {
              res.writeHead(401);
              res.end(JSON.stringify({ error: "invalid_client" }));
              return;
            }

            // Verify grant_type
            const params = new URLSearchParams(body);
            if (params.get("grant_type") !== "client_credentials") {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "unsupported_grant_type" }));
              return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({
              access_token: `token-${tokenRequestCount}`,
              token_type: "bearer",
              expires_in: 3600,
            }));
            return;
          }

          // Protected API endpoint
          if (req.url === "/api/data" && req.method === "GET") {
            const auth = req.headers.authorization;
            if (!auth?.startsWith("Bearer token-")) {
              res.writeHead(401);
              res.end(JSON.stringify({ error: "unauthorized" }));
              return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({ items: [{ id: "1" }], token_used: auth }));
            return;
          }

          res.writeHead(404);
          res.end("{}");
        });
      });
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => server?.close());

  it("should automatically fetch OAuth2 token and use it for requests", async () => {
    tokenRequestCount = 0;
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      auth: {
        type: "oauth2",
        tokenUrl: `http://localhost:${port}/oauth/token`,
        clientId: "my-client",
        clientSecret: "my-secret",
      },
    });

    const result = await backend.read("/api/data") as any;
    expect(result.items).toEqual([{ id: "1" }]);
    expect(result.token_used).toBe("Bearer token-1");
    expect(tokenRequestCount).toBe(1);
  });

  it("should cache the token across multiple requests", async () => {
    tokenRequestCount = 0;
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      auth: {
        type: "oauth2",
        tokenUrl: `http://localhost:${port}/oauth/token`,
        clientId: "my-client",
        clientSecret: "my-secret",
      },
    });

    await backend.read("/api/data");
    await backend.read("/api/data");
    await backend.read("/api/data");

    // Token should only be fetched once (cached)
    expect(tokenRequestCount).toBe(1);
  });

  it("should pass scope if provided", async () => {
    let tokenBody = "";
    const mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Content-Type", "application/json");
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = chunks.length ? Buffer.concat(chunks).toString() : "";
        if (req.url === "/token") {
          tokenBody = body; // capture only the token request body
          res.end(JSON.stringify({ access_token: "t", expires_in: 3600 }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(0, resolve));
    const p = (mockServer.address() as any).port;

    const backend = new HttpBackend({
      baseUrl: `http://localhost:${p}`,
      auth: {
        type: "oauth2",
        tokenUrl: `http://localhost:${p}/token`,
        clientId: "c",
        clientSecret: "s",
        scope: "read write",
      },
    });

    await backend.read("/test");
    expect(tokenBody).toContain("scope=read+write");

    mockServer.close();
  });

  it("should fail gracefully on invalid credentials", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      auth: {
        type: "oauth2",
        tokenUrl: `http://localhost:${port}/oauth/token`,
        clientId: "wrong",
        clientSecret: "wrong",
      },
    });

    await expect(backend.read("/api/data")).rejects.toThrow("OAuth2 token request failed");
  });
});
