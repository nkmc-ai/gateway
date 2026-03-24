import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import {
  RpcBackend,
  JsonRpcTransport,
  RpcError,
  type RpcResource,
} from "../src/backends/rpc.js";
import { AgentFs } from "../src/agent-fs.js";

// --- Mock CRUD data store ---

type Item = { id: string; name: string };
type Tag = { id: string; label: string };

function createStore() {
  const items = new Map<string, Item>([
    ["1", { id: "1", name: "Alpha" }],
    ["2", { id: "2", name: "Bravo" }],
    ["3", { id: "3", name: "Charlie" }],
  ]);

  const tags = new Map<string, Tag>([
    ["t1", { id: "t1", label: "urgent" }],
    ["t2", { id: "t2", label: "low" }],
  ]);

  return { items, tags };
}

// --- Fault injection ---

type HttpFault = "429" | "500" | "empty" | "html" | "400";
type RpcFault = "internal" | "server" | "method-not-found" | "invalid-request" | "invalid-params";

function createFaultInjector() {
  const httpFaultQueue: HttpFault[] = [];
  const rpcFaultQueue: RpcFault[] = [];
  let requestCount = 0;
  /** Custom Retry-After value for next 429 */
  let retryAfterValue: string | null = null;

  return {
    injectHttpFault(...faults: HttpFault[]) {
      httpFaultQueue.push(...faults);
    },
    injectRpcFault(...faults: RpcFault[]) {
      rpcFaultQueue.push(...faults);
    },
    setRetryAfter(value: string | null) {
      retryAfterValue = value;
    },
    getRequestCount() {
      return requestCount;
    },
    resetRequestCount() {
      requestCount = 0;
    },
    /** Called by mock server on each request — returns fault response or null */
    checkHttpFault(res: import("node:http").ServerResponse): boolean {
      requestCount++;
      const fault = httpFaultQueue.shift();
      if (!fault) return false;

      switch (fault) {
        case "429": {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (retryAfterValue) {
            headers["Retry-After"] = retryAfterValue;
            retryAfterValue = null;
          }
          res.writeHead(429, headers);
          res.end(JSON.stringify({ error: "Too Many Requests" }));
          return true;
        }
        case "500":
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
          return true;
        case "400":
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad Request" }));
          return true;
        case "empty":
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("");
          return true;
        case "html":
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body>Bad Gateway</body></html>");
          return true;
      }
    },
    /** Called after body is parsed — returns RPC error or null */
    checkRpcFault(): { code: number; message: string } | null {
      const fault = rpcFaultQueue.shift();
      if (!fault) return null;

      switch (fault) {
        case "internal":
          return { code: -32603, message: "Internal error" };
        case "server":
          return { code: -32050, message: "Server error" };
        case "method-not-found":
          return { code: -32601, message: "Method not found" };
        case "invalid-request":
          return { code: -32600, message: "Invalid Request" };
        case "invalid-params":
          return { code: -32602, message: "Invalid params" };
      }
    },
  };
}

// --- Mock JSON-RPC CRUD server ---

function createMockCrudServer(
  store: ReturnType<typeof createStore>,
  faults: ReturnType<typeof createFaultInjector>,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      // Check HTTP-level faults first (before reading body)
      if (faults.checkHttpFault(res)) return;

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let body: any;
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
          return;
        }

        // Batch request
        if (Array.isArray(body)) {
          // Check RPC-level faults for batch
          const rpcFault = faults.checkRpcFault();
          if (rpcFault) {
            const results = body.map((r: any) => ({
              jsonrpc: "2.0",
              id: r.id,
              error: rpcFault,
            }));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(results));
            return;
          }

          const results = body.map((r: any) => {
            const { result, error } = handleMethod(r.method, r.params ?? [], store);
            if (error) return { jsonrpc: "2.0", id: r.id, error };
            return { jsonrpc: "2.0", id: r.id, result };
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(results));
          return;
        }

        // Single request — check RPC fault
        const rpcFault = faults.checkRpcFault();
        if (rpcFault) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: rpcFault }));
          return;
        }

        const { result, error } = handleMethod(body.method, body.params ?? [], store);
        res.writeHead(200, { "Content-Type": "application/json" });
        if (error) {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error }));
        } else {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
        }
      });
    });

    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://localhost:${port}` });
    });
  });
}

function handleMethod(
  method: string,
  params: unknown[],
  store: ReturnType<typeof createStore>,
): { result?: unknown; error?: { code: number; message: string } } {
  switch (method) {
    case "store.list":
      return { result: Array.from(store.items.values()) };

    case "store.get": {
      const id = params[0] as string;
      const item = store.items.get(id);
      return { result: item ?? null };
    }

    case "store.create": {
      const data = params[0] as Item;
      store.items.set(data.id, data);
      return { result: data.id };
    }

    case "store.update": {
      const [id, updates] = params as [string, Partial<Item>];
      const existing = store.items.get(id);
      if (!existing) return { result: null };
      const updated = { ...existing, ...updates };
      store.items.set(id, updated);
      return { result: updated.id };
    }

    case "store.delete": {
      const delId = params[0] as string;
      const deleted = store.items.delete(delId);
      return { result: deleted };
    }

    case "store.search": {
      const pattern = params[0] as string;
      const matches = Array.from(store.items.values()).filter(
        (item) => JSON.stringify(item).includes(pattern),
      );
      return { result: matches };
    }

    case "tags.list":
      return { result: Array.from(store.tags.values()) };

    case "tags.get": {
      const tagId = params[0] as string;
      const tag = store.tags.get(tagId);
      return { result: tag ?? null };
    }

    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

// --- RPC resource configuration ---

function createCrudResources(): RpcResource[] {
  return [
    {
      name: "items",
      idField: "id",
      methods: {
        list: {
          method: "store.list",
          params: () => [],
        },
        read: {
          method: "store.get",
          params: (ctx) => [ctx.id!],
        },
        create: {
          method: "store.create",
          params: (ctx) => [ctx.data],
        },
        write: {
          method: "store.update",
          params: (ctx) => [ctx.id!, ctx.data],
        },
        remove: {
          method: "store.delete",
          params: (ctx) => [ctx.id!],
        },
        search: {
          method: "store.search",
          params: (ctx) => [ctx.pattern!],
        },
      },
    },
    {
      name: "tags",
      idField: "id",
      methods: {
        list: {
          method: "tags.list",
          params: () => [],
        },
        read: {
          method: "tags.get",
          params: (ctx) => [ctx.id!],
        },
      },
    },
  ];
}

// --- Tests ---

describe("RpcBackend CRUD + Resilience", () => {
  let server: Server;
  let store: ReturnType<typeof createStore>;
  let faults: ReturnType<typeof createFaultInjector>;
  let transport: JsonRpcTransport;
  let backend: RpcBackend;
  let agentFs: AgentFs;

  beforeAll(async () => {
    store = createStore();
    faults = createFaultInjector();
    const mock = await createMockCrudServer(store, faults);
    server = mock.server;

    transport = new JsonRpcTransport({
      url: mock.baseUrl,
      retry: { maxRetries: 3, baseDelayMs: 10 }, // fast retries for tests
    });

    backend = new RpcBackend({
      transport,
      resources: createCrudResources(),
    });

    agentFs = new AgentFs({
      mounts: [{ path: "/rpc", backend }],
    });
  });

  afterAll(
    () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  );

  // ============================================================
  // Full-chain: CLI → AgentFs → RpcBackend → Transport → HTTP
  // ============================================================

  describe("Full-chain: CLI → AgentFs → RpcBackend → Transport → HTTP", () => {
    it("ls / → contains rpc/", async () => {
      const result = await agentFs.execute("ls /");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toContain("rpc/");
    });

    it("ls /rpc/ → contains items/, tags/", async () => {
      const result = await agentFs.execute("ls /rpc/");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("items/");
        expect(result.data).toContain("tags/");
      }
    });

    it("ls /rpc/items/ → returns item ID list", async () => {
      const result = await agentFs.execute("ls /rpc/items/");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as string[];
        expect(data).toContain("1.json");
        expect(data).toContain("2.json");
        expect(data).toContain("3.json");
      }
    });

    it("cat /rpc/items/1.json → returns item detail", async () => {
      const result = await agentFs.execute("cat /rpc/items/1.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Item;
        expect(data.id).toBe("1");
        expect(data.name).toBe("Alpha");
      }
    });

    it("write /rpc/items/ → creates new item", async () => {
      const result = await agentFs.execute(
        'write /rpc/items/ \'{"id":"4","name":"Delta"}\'',
      );
      expect(result.ok).toBe(true);
    });

    it("cat /rpc/items/4.json → verifies created item", async () => {
      const result = await agentFs.execute("cat /rpc/items/4.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Item;
        expect(data.id).toBe("4");
        expect(data.name).toBe("Delta");
      }
    });

    it("write /rpc/items/1.json → updates existing item", async () => {
      const result = await agentFs.execute(
        'write /rpc/items/1.json \'{"name":"Updated"}\'',
      );
      expect(result.ok).toBe(true);
    });

    it("cat /rpc/items/1.json → verifies updated item", async () => {
      const result = await agentFs.execute("cat /rpc/items/1.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Item;
        expect(data.name).toBe("Updated");
      }
    });

    it("rm /rpc/items/2.json → deletes item", async () => {
      const result = await agentFs.execute("rm /rpc/items/2.json");
      expect(result.ok).toBe(true);
    });

    it("cat /rpc/items/2.json → deleted item returns NotFound", async () => {
      const result = await agentFs.execute("cat /rpc/items/2.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("grep Alpha /rpc/items/ → searches matching items", async () => {
      // Note: item 1 was updated to "Updated", so "Alpha" should not match
      // But let's add a fresh one and search
      store.items.set("5", { id: "5", name: "AlphaTwo" });
      const result = await agentFs.execute("grep AlphaTwo /rpc/items/");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Item[];
        expect(data.length).toBeGreaterThanOrEqual(1);
        expect(data.some((item) => item.name === "AlphaTwo")).toBe(true);
      }
    });

    it("cat /rpc/tags/t1.json → reads read-only resource", async () => {
      const result = await agentFs.execute("cat /rpc/tags/t1.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Tag;
        expect(data.id).toBe("t1");
        expect(data.label).toBe("urgent");
      }
    });
  });

  // ============================================================
  // Transport resilience: HTTP-level
  // ============================================================

  describe("Transport resilience: HTTP-level", () => {
    it("429 twice then success → requestCount=3", async () => {
      faults.resetRequestCount();
      faults.injectHttpFault("429", "429");
      const result = await transport.call("store.list", []);
      expect(faults.getRequestCount()).toBe(3);
      expect(Array.isArray(result)).toBe(true);
    });

    it("500 twice then success → requestCount=3", async () => {
      faults.resetRequestCount();
      faults.injectHttpFault("500", "500");
      const result = await transport.call("store.list", []);
      expect(faults.getRequestCount()).toBe(3);
      expect(Array.isArray(result)).toBe(true);
    });

    it("400 does not retry → requestCount=1", async () => {
      faults.resetRequestCount();
      faults.injectHttpFault("400");
      // 400 returns non-JSON-RPC body, safeRpcJson will parse the error JSON
      // but it won't have jsonrpc format, so it'll just return the parsed object
      // Actually the mock returns { error: "Bad Request" } which is not valid JSON-RPC
      // The transport checks HTTP status first — 400 is not retryable and not >=500
      // But it's also not `ok` (200-299). Let's see what happens:
      // isRetryableHttpStatus(400) → false, so we proceed to safeRpcJson
      // safeRpcJson parses { error: "Bad Request" }, result.error is truthy
      // result.error.code is undefined, isRetryableRpcError(undefined) → false
      // So it throws RpcError(undefined, undefined)
      try {
        await transport.call("store.list", []);
      } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
      }
      expect(faults.getRequestCount()).toBe(1);
    });

    it("Retry-After header overrides baseDelay", async () => {
      faults.resetRequestCount();
      faults.setRetryAfter("0"); // 0 seconds — fast
      faults.injectHttpFault("429");
      const start = Date.now();
      await transport.call("store.list", []);
      const elapsed = Date.now() - start;
      expect(faults.getRequestCount()).toBe(2);
      // With Retry-After: 0, delay should be ~0ms (not baseDelay)
      expect(elapsed).toBeLessThan(200);
    });

    it("maxRetries exhausted → throws error", async () => {
      // Create a transport with maxRetries=1 for this test
      const limitedTransport = new JsonRpcTransport({
        url: `http://localhost:${(server.address() as any).port}`,
        retry: { maxRetries: 1, baseDelayMs: 10 },
      });
      faults.resetRequestCount();
      faults.injectHttpFault("429", "429"); // 2 faults, only 1 retry allowed
      await expect(
        limitedTransport.call("store.list", []),
      ).rejects.toThrow();
      expect(faults.getRequestCount()).toBe(2); // initial + 1 retry
    });
  });

  // ============================================================
  // Transport resilience: RPC-level
  // ============================================================

  describe("Transport resilience: RPC-level", () => {
    it("-32603 retries then succeeds", async () => {
      faults.resetRequestCount();
      faults.injectRpcFault("internal");
      const result = await transport.call("store.list", []);
      expect(faults.getRequestCount()).toBe(2);
      expect(Array.isArray(result)).toBe(true);
    });

    it("-32050 retries then succeeds", async () => {
      faults.resetRequestCount();
      faults.injectRpcFault("server");
      const result = await transport.call("store.list", []);
      expect(faults.getRequestCount()).toBe(2);
      expect(Array.isArray(result)).toBe(true);
    });

    it("-32601 does not retry", async () => {
      faults.resetRequestCount();
      faults.injectRpcFault("method-not-found");
      await expect(
        transport.call("store.list", []),
      ).rejects.toThrow(RpcError);
      expect(faults.getRequestCount()).toBe(1);
    });

    it("-32600 does not retry", async () => {
      faults.resetRequestCount();
      faults.injectRpcFault("invalid-request");
      await expect(
        transport.call("store.list", []),
      ).rejects.toThrow(RpcError);
      expect(faults.getRequestCount()).toBe(1);
    });

    it("-32602 does not retry", async () => {
      faults.resetRequestCount();
      faults.injectRpcFault("invalid-params");
      await expect(
        transport.call("store.list", []),
      ).rejects.toThrow(RpcError);
      expect(faults.getRequestCount()).toBe(1);
    });
  });

  // ============================================================
  // Transport resilience: safeRpcJson
  // ============================================================

  describe("Transport resilience: safeRpcJson", () => {
    it("empty body → RpcError(-32700)", async () => {
      faults.injectHttpFault("empty");
      await expect(
        transport.call("store.list", []),
      ).rejects.toThrow(RpcError);
      try {
        faults.injectHttpFault("empty");
        await transport.call("store.list", []);
      } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect((err as RpcError).code).toBe(-32700);
      }
    });

    it("non-JSON (HTML) → RpcError(-32700)", async () => {
      faults.injectHttpFault("html");
      await expect(
        transport.call("store.list", []),
      ).rejects.toThrow(RpcError);
      try {
        faults.injectHttpFault("html");
        await transport.call("store.list", []);
      } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect((err as RpcError).code).toBe(-32700);
      }
    });
  });

  // ============================================================
  // Batch resilience
  // ============================================================

  describe("Batch resilience", () => {
    it("batch 429 → entire batch retries then succeeds", async () => {
      faults.resetRequestCount();
      faults.injectHttpFault("429");
      const results = await transport.batch!([
        { method: "store.list", params: [] },
        { method: "tags.list", params: [] },
      ]);
      expect(faults.getRequestCount()).toBe(2);
      expect(results).toHaveLength(2);
      expect(Array.isArray(results[0])).toBe(true);
      expect(Array.isArray(results[1])).toBe(true);
    });

    it("batch with retryable RPC error → entire batch retries", async () => {
      faults.resetRequestCount();
      faults.injectRpcFault("internal");
      const results = await transport.batch!([
        { method: "store.list", params: [] },
        { method: "tags.list", params: [] },
      ]);
      expect(faults.getRequestCount()).toBe(2);
      expect(results).toHaveLength(2);
    });
  });
});
