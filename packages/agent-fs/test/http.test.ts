import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import {
  HttpBackend,
  type HttpBackendConfig,
} from "../src/backends/http.js";

// --- Mock API server ---

interface MockRecord {
  id: string;
  [key: string]: unknown;
}

const mockData: Record<string, MockRecord[]> = {
  users: [
    { id: "1", name: "Alice", status: "active" },
    { id: "2", name: "Bob", status: "inactive" },
    { id: "3", name: "Charlie", status: "active" },
  ],
  products: [
    { id: "1", name: "Widget", price: 9.99 },
    { id: "2", name: "Gadget", price: 19.99 },
  ],
};

let server: Server;
let baseUrl: string;

function createMockApiServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const path = url.pathname;
      const query = url.searchParams.get("q");

      res.setHeader("Content-Type", "application/json");

      // Verify auth
      const auth = req.headers.authorization;
      if (auth !== "Bearer test-token") {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      // Read body for POST/PUT
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined;

        // Route: GET /api/search?q=...
        if (path === "/api/search" && req.method === "GET") {
          const results = Object.values(mockData)
            .flat()
            .filter((r) => JSON.stringify(r).includes(query ?? ""));
          res.writeHead(200);
          res.end(JSON.stringify(results));
          return;
        }

        // Route: POST /api/orders
        if (path === "/api/orders" && req.method === "POST") {
          res.writeHead(201);
          res.end(JSON.stringify({ id: "order-1", ...body }));
          return;
        }

        // Resource routes: /{resource} and /{resource}/{id}
        const resourceMatch = path.match(/^\/(\w+)(?:\/(\w+))?$/);
        if (resourceMatch) {
          const [, resource, id] = resourceMatch;
          const collection = mockData[resource];

          if (!collection) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          switch (req.method) {
            case "GET": {
              if (id) {
                const record = collection.find((r) => r.id === id);
                if (!record) {
                  res.writeHead(404);
                  res.end(JSON.stringify({ error: "Not found" }));
                  return;
                }
                res.writeHead(200);
                res.end(JSON.stringify(record));
              } else {
                let items = collection;
                if (query) {
                  items = collection.filter((r) =>
                    JSON.stringify(r).includes(query),
                  );
                }
                res.writeHead(200);
                res.end(JSON.stringify({ data: items }));
              }
              return;
            }
            case "POST": {
              const newId = String(collection.length + 1);
              const newRecord = { id: newId, ...body };
              collection.push(newRecord);
              res.writeHead(201);
              res.end(JSON.stringify(newRecord));
              return;
            }
            case "PUT": {
              if (!id) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "ID required" }));
                return;
              }
              const idx = collection.findIndex((r) => r.id === id);
              if (idx === -1) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: "Not found" }));
                return;
              }
              collection[idx] = { ...collection[idx], ...body, id };
              res.writeHead(200);
              res.end(JSON.stringify(collection[idx]));
              return;
            }
            case "DELETE": {
              if (!id) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "ID required" }));
                return;
              }
              const delIdx = collection.findIndex((r) => r.id === id);
              if (delIdx === -1) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: "Not found" }));
                return;
              }
              collection.splice(delIdx, 1);
              res.writeHead(200);
              res.end(JSON.stringify({ deleted: true }));
              return;
            }
          }
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://localhost:${port}` });
    });
  });
}

// --- Tests ---

describe("HttpBackend", () => {
  let backend: HttpBackend;

  beforeAll(async () => {
    const mock = await createMockApiServer();
    server = mock.server;
    baseUrl = mock.baseUrl;

    backend = new HttpBackend({
      baseUrl,
      auth: { type: "bearer", token: "test-token" },
      resources: [
        {
          name: "users",
          listKey: "data",
          fields: [
            { name: "id", type: "string" },
            { name: "name", type: "string" },
            { name: "status", type: "string" },
          ],
        },
        { name: "products", listKey: "data" },
      ],
      endpoints: [
        {
          name: "search",
          method: "GET",
          apiPath: "/api/search",
          description: "Search across all resources",
        },
        {
          name: "orders",
          method: "POST",
          apiPath: "/api/orders",
          description: "Create an order",
        },
      ],
    });
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  describe("list", () => {
    it("should list resources and _api at root", async () => {
      const result = await backend.list("/");
      expect(result).toContain("users/");
      expect(result).toContain("products/");
      expect(result).toContain("_api/");
    });

    it("should list record IDs in a resource", async () => {
      const result = await backend.list("/users/");
      expect(result).toContain("1.json");
      expect(result).toContain("2.json");
      expect(result).toContain("3.json");
    });

    it("should list available endpoints", async () => {
      const result = await backend.list("/_api/");
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("search");
      expect(result[1]).toContain("orders");
    });
  });

  describe("read", () => {
    it("should read a single record", async () => {
      const result = (await backend.read("/users/1.json")) as {
        name: string;
      };
      expect(result.name).toBe("Alice");
    });

    it("should read all records in a resource", async () => {
      const result = (await backend.read("/users/")) as unknown[];
      expect(result).toHaveLength(3);
    });

    it("should read _schema", async () => {
      const result = (await backend.read("/users/_schema")) as {
        resource: string;
        fields: unknown[];
      };
      expect(result.resource).toBe("users");
      expect(result.fields).toHaveLength(3);
    });

    it("should invoke a GET endpoint", async () => {
      const result = (await backend.read("/_api/search")) as unknown[];
      expect(Array.isArray(result)).toBe(true);
    });

    it("should throw NotFoundError for missing record", async () => {
      await expect(backend.read("/users/999.json")).rejects.toThrow();
    });
  });

  describe("write", () => {
    it("should create a new record", async () => {
      const result = await backend.write("/users/", {
        name: "Dave",
        status: "active",
      });
      expect(result.id).toBeDefined();
    });

    it("should update an existing record", async () => {
      const result = await backend.write("/users/1.json", {
        name: "Alice Updated",
      });
      expect(result.id).toBe("1");

      const updated = (await backend.read("/users/1.json")) as {
        name: string;
      };
      expect(updated.name).toBe("Alice Updated");
    });

    it("should invoke a POST endpoint", async () => {
      const result = await backend.write("/_api/orders", {
        product: "Widget",
        quantity: 2,
      });
      expect(result.id).toBe("order-1");
    });
  });

  describe("remove", () => {
    it("should delete a record", async () => {
      await backend.remove("/users/2.json");
      const list = await backend.list("/users/");
      expect(list).not.toContain("2.json");
    });

    it("should throw for non-existent record", async () => {
      await expect(backend.remove("/users/999.json")).rejects.toThrow();
    });
  });

  describe("search", () => {
    it("should search records with server-side query", async () => {
      const results = (await backend.search("/users/", "active")) as {
        name: string;
      }[];
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("auth", () => {
    it("should fail without correct auth", async () => {
      const noAuthBackend = new HttpBackend({
        baseUrl,
        auth: { type: "bearer", token: "wrong-token" },
        resources: [{ name: "users", listKey: "data" }],
      });

      // The mock server returns 401, list returns empty because response is not array
      await expect(noAuthBackend.read("/users/1.json")).rejects.toThrow();
    });
  });

  describe("integration with AgentFs", async () => {
    const { AgentFs } = await import("../src/agent-fs.js");

    it("should work as a mount in AgentFs", async () => {
      const agentFs = new AgentFs({
        mounts: [{ path: "/service", backend }],
      });

      const lsRoot = await agentFs.execute("ls /");
      expect(lsRoot.ok).toBe(true);
      if (lsRoot.ok) {
        expect(lsRoot.data).toContain("service/");
      }

      const lsService = await agentFs.execute("ls /service/");
      expect(lsService.ok).toBe(true);
      if (lsService.ok) {
        expect(lsService.data).toContain("users/");
      }

      const catUser = await agentFs.execute("cat /service/users/1.json");
      expect(catUser.ok).toBe(true);
      if (catUser.ok) {
        expect((catUser.data as { name: string }).name).toBe("Alice Updated");
      }
    });
  });
});
