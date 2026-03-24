import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpBackend } from "../src/backends/http.js";
import { safeJson } from "../src/backends/http.js";

describe("safeJson", () => {
  it("should return null for 204 No Content", async () => {
    const resp = new Response(null, { status: 204 });
    expect(await safeJson(resp)).toBeNull();
  });

  it("should return null for empty body", async () => {
    const resp = new Response("", { status: 200 });
    expect(await safeJson(resp)).toBeNull();
  });

  it("should return null for whitespace-only body", async () => {
    const resp = new Response("  \n  ", { status: 200 });
    expect(await safeJson(resp)).toBeNull();
  });

  it("should parse valid JSON", async () => {
    const resp = new Response('{"id":1}', { status: 200 });
    expect(await safeJson(resp)).toEqual({ id: 1 });
  });

  it("should return null for invalid JSON", async () => {
    const resp = new Response("<html>error</html>", { status: 200 });
    expect(await safeJson(resp)).toBeNull();
  });
});

describe("HttpBackend 204 handling (mock server)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", "http://localhost");

        // DELETE /items/{id} → 204 No Content (like DigitalOcean)
        if (req.method === "DELETE" && url.pathname.startsWith("/items/")) {
          res.writeHead(204);
          res.end();
          return;
        }

        // PUT /items/{id} → 200 with empty body (edge case)
        if (req.method === "PUT" && url.pathname.startsWith("/items/")) {
          res.writeHead(200);
          res.end();
          return;
        }

        // GET /items → list
        if (req.method === "GET" && url.pathname === "/items") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([{ id: "1", name: "A" }]));
          return;
        }

        // GET /items/{id} → single item
        if (req.method === "GET" && url.pathname.startsWith("/items/")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "1", name: "A" }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => server?.close());

  it("DELETE returning 204 should not crash", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "items", apiPath: "/items" }],
    });

    // This used to crash with JSON parse error on empty body
    await expect(backend.remove("/items/1.json")).resolves.not.toThrow();
  });

  it("PUT returning empty 200 should not crash", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "items", apiPath: "/items" }],
    });

    // write (update) to /items/1 — server returns empty 200
    const result = await backend.write("/items/1.json", { name: "B" });
    expect(result.id).toBe("1"); // Falls back to the path ID
  });
});
