import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpBackend } from "../src/backends/http.js";

describe("HttpBackend 429 retry with backoff", () => {
  let server: Server;
  let port: number;
  let requestCount: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.setHeader("Content-Type", "application/json");
        requestCount++;

        // /rate-limited → 429 twice, then 200
        if (req.url === "/rate-limited") {
          if (requestCount <= 2) {
            res.writeHead(429, { "Retry-After": "0" }); // 0 seconds for fast tests
            res.end(JSON.stringify({ error: "rate limited" }));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ id: "ok", data: "success" }));
          }
          return;
        }

        // /always-429 → always 429
        if (req.url === "/always-429") {
          res.writeHead(429, { "Retry-After": "0" });
          res.end(JSON.stringify({ error: "rate limited" }));
          return;
        }

        // /server-error → 500 twice, then 200
        if (req.url === "/server-error") {
          if (requestCount <= 2) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "internal error" }));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify([{ id: "1" }]));
          }
          return;
        }

        // /client-error → 400 (should not retry)
        if (req.url === "/client-error") {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "bad request" }));
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      });
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => server?.close());

  beforeAll(() => {
    requestCount = 0;
  });

  it("should retry on 429 and eventually succeed", async () => {
    requestCount = 0;
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      retry: { maxRetries: 3, baseDelayMs: 10 },
    });

    const result = await backend.read("/rate-limited");
    expect(result).toEqual({ id: "ok", data: "success" });
    expect(requestCount).toBe(3); // 2 x 429 + 1 x 200
  });

  it("should retry on 5xx and eventually succeed", async () => {
    requestCount = 0;
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      retry: { maxRetries: 3, baseDelayMs: 10 },
    });

    const items = await backend.list("/server-error");
    // Since it's passthrough mode, list returns parsed response
    expect(requestCount).toBe(3);
  });

  it("should NOT retry on 400 client error", async () => {
    requestCount = 0;
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      retry: { maxRetries: 3, baseDelayMs: 10 },
    });

    // 400 should not be retried — passthrough list returns empty
    await backend.list("/client-error");
    expect(requestCount).toBe(1); // Only 1 request, no retry
  });

  it("should give up after maxRetries exhausted", async () => {
    requestCount = 0;
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      retry: { maxRetries: 2, baseDelayMs: 10 },
    });

    // always-429 will never succeed
    await backend.list("/always-429");
    expect(requestCount).toBe(3); // 1 initial + 2 retries
  });

  it("should respect Retry-After header", async () => {
    requestCount = 0;
    const start = Date.now();
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${port}`,
      retry: { maxRetries: 3, baseDelayMs: 5000 }, // high base delay
    });

    // Retry-After: 0 should override the high base delay
    await backend.read("/rate-limited");
    const elapsed = Date.now() - start;
    // With Retry-After: 0, should complete quickly despite high baseDelayMs
    expect(elapsed).toBeLessThan(1000);
  });
});
