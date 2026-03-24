import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpBackend } from "../src/backends/http.js";
import { getNestedValue } from "../src/backends/http.js";

describe("getNestedValue", () => {
  it("should resolve dot-separated paths", () => {
    expect(getNestedValue({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("should resolve single-level paths", () => {
    expect(getNestedValue({ cursor: "abc" }, "cursor")).toBe("abc");
  });

  it("should return undefined for missing paths", () => {
    expect(getNestedValue({ a: 1 }, "b")).toBeUndefined();
    expect(getNestedValue(null, "a")).toBeUndefined();
  });
});

describe("Cursor pagination", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/items") {
          const cursor = url.searchParams.get("starting_after");
          if (!cursor) {
            // Page 1
            res.end(JSON.stringify({
              data: [{ id: "a" }, { id: "b" }],
              has_more: true,
              next_cursor: "b",
            }));
          } else if (cursor === "b") {
            // Page 2
            res.end(JSON.stringify({
              data: [{ id: "c" }, { id: "d" }],
              has_more: true,
              next_cursor: "d",
            }));
          } else {
            // Page 3 (last)
            res.end(JSON.stringify({
              data: [{ id: "e" }],
              has_more: false,
            }));
          }
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

  it("should follow cursor pagination across multiple pages", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "items", apiPath: "/items", listKey: "data" }],
      pagination: {
        type: "cursor",
        cursorParam: "starting_after",
        cursorPath: "next_cursor",
        maxPages: 10,
      },
    });

    const items = await backend.list("/items/");
    expect(items).toEqual(["a.json", "b.json", "c.json", "d.json", "e.json"]);
  });

  it("should respect maxPages limit", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "items", apiPath: "/items", listKey: "data" }],
      pagination: {
        type: "cursor",
        cursorParam: "starting_after",
        cursorPath: "next_cursor",
        maxPages: 2, // Only fetch 2 pages total
      },
    });

    const items = await backend.list("/items/");
    // Page 1: a,b + Page 2: c,d (maxPages=2 means 1 additional page)
    expect(items).toEqual(["a.json", "b.json", "c.json", "d.json"]);
  });
});

describe("Offset pagination", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/records") {
          const offset = parseInt(url.searchParams.get("offset") ?? "0");
          const limit = parseInt(url.searchParams.get("limit") ?? "2");
          const allItems = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }];
          const page = allItems.slice(offset, offset + limit);
          res.end(JSON.stringify({ items: page, total: allItems.length }));
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

  it("should follow offset pagination", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "records", apiPath: "/records", listKey: "items" }],
      pagination: {
        type: "offset",
        offsetParam: "offset",
        limitParam: "limit",
        pageSize: 2,
        maxPages: 10,
      },
    });

    const items = await backend.list("/records/");
    expect(items).toEqual(["1.json", "2.json", "3.json", "4.json", "5.json"]);
  });
});

describe("Page pagination", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/entries") {
          const page = parseInt(url.searchParams.get("page") ?? "1");
          if (page === 1) {
            res.end(JSON.stringify({ results: [{ id: "x" }, { id: "y" }] }));
          } else if (page === 2) {
            res.end(JSON.stringify({ results: [{ id: "z" }] }));
          } else {
            res.end(JSON.stringify({ results: [] }));
          }
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

  it("should follow page pagination", async () => {
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      resources: [{ name: "entries", apiPath: "/entries", listKey: "results" }],
      pagination: {
        type: "page",
        pageParam: "page",
        maxPages: 10,
      },
    });

    const items = await backend.list("/entries/");
    expect(items).toEqual(["x.json", "y.json", "z.json"]);
  });
});
