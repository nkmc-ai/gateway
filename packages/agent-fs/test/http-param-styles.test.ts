import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpBackend } from "../src/backends/http.js";

describe("HttpBackend {param} path parameter support", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");

        // /accounts/acc123/records → list
        const listMatch = req.url?.match(/^\/accounts\/(\w+)\/records$/);
        if (listMatch && req.method === "GET") {
          res.end(JSON.stringify([
            { id: "r1", account: listMatch[1] },
            { id: "r2", account: listMatch[1] },
          ]));
          return;
        }

        // /accounts/acc123/records/r1 → single item
        const getMatch = req.url?.match(/^\/accounts\/(\w+)\/records\/(\w+)$/);
        if (getMatch && req.method === "GET") {
          res.end(JSON.stringify({ id: getMatch[2], account: getMatch[1], data: "test" }));
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

  it("should resolve {accountId} style params in apiPath", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      params: { accountId: "acc123" },
      resources: [{
        name: "records",
        apiPath: "/accounts/{accountId}/records",
      }],
    });

    const items = await backend.list("/records/");
    expect(items).toEqual(["r1.json", "r2.json"]);
  });

  it("should resolve :accountId style params (existing behavior)", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      params: { accountId: "acc123" },
      resources: [{
        name: "records",
        apiPath: "/accounts/:accountId/records",
      }],
    });

    const items = await backend.list("/records/");
    expect(items).toEqual(["r1.json", "r2.json"]);
  });

  it("should resolve {param} in cat path", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      params: { accountId: "acc123" },
      resources: [{
        name: "records",
        apiPath: "/accounts/{accountId}/records",
      }],
    });

    const result = await backend.read("/records/r1.json") as Record<string, unknown>;
    expect(result.id).toBe("r1");
    expect(result.account).toBe("acc123");
  });

  it("should throw for missing {param}", () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      params: {}, // no accountId
      resources: [{
        name: "records",
        apiPath: "/accounts/{accountId}/records",
      }],
    });

    expect(() => backend.list("/records/")).rejects.toThrow("Missing param: accountId");
  });
});
