import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpBackend } from "../src/backends/http.js";
import { extractList } from "../src/backends/http.js";

describe("extractList", () => {
  it("should return data directly if it's already an array", () => {
    expect(extractList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("should use explicit listKey", () => {
    expect(extractList({ result: [1, 2], total: 2 }, "result")).toEqual([1, 2]);
  });

  it("should auto-detect first array property (Cloudflare: result)", () => {
    const data = { success: true, errors: [], messages: [], result: [{ id: "z1" }] };
    expect(extractList(data)).toEqual([{ id: "z1" }]);
  });

  it("should auto-detect first array property (Stripe: data)", () => {
    const data = { object: "list", data: [{ id: "cus_1" }], has_more: false };
    expect(extractList(data)).toEqual([{ id: "cus_1" }]);
  });

  it("should return data as-is if no array found", () => {
    const data = { id: 1, name: "test" };
    expect(extractList(data)).toEqual(data);
  });

  it("should handle null/undefined", () => {
    expect(extractList(null)).toBeNull();
    expect(extractList(undefined)).toBeUndefined();
  });
});

describe("HttpBackend listKey auto-inference (mock server)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");

        // Cloudflare-style wrapped response
        if (req.url === "/zones") {
          res.end(JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: [
              { id: "zone1", name: "example.com" },
              { id: "zone2", name: "test.com" },
            ],
          }));
          return;
        }

        // Stripe-style wrapped response
        if (req.url === "/customers") {
          res.end(JSON.stringify({
            object: "list",
            data: [
              { id: "cus_1", name: "Alice" },
              { id: "cus_2", name: "Bob" },
            ],
            has_more: false,
          }));
          return;
        }

        // Direct array response (GitHub-style)
        if (req.url === "/repos") {
          res.end(JSON.stringify([
            { id: 1, name: "repo-a" },
            { id: 2, name: "repo-b" },
          ]));
          return;
        }

        res.writeHead(404);
        res.end("{}");
      });
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => server?.close());

  it("should auto-detect listKey for Cloudflare-style { result: [...] }", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "zones", apiPath: "/zones" }],
    });
    const items = await backend.list("/zones/");
    expect(items).toEqual(["zone1.json", "zone2.json"]);
  });

  it("should auto-detect listKey for Stripe-style { data: [...] }", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "customers", apiPath: "/customers" }],
    });
    const items = await backend.list("/customers/");
    expect(items).toEqual(["cus_1.json", "cus_2.json"]);
  });

  it("should handle direct array response (GitHub-style)", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "repos", apiPath: "/repos" }],
    });
    const items = await backend.list("/repos/");
    expect(items).toEqual(["1.json", "2.json"]);
  });

  it("explicit listKey takes precedence over auto-detect", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "zones", apiPath: "/zones", listKey: "result" }],
    });
    const items = await backend.list("/zones/");
    expect(items).toEqual(["zone1.json", "zone2.json"]);
  });
});
