import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { OnboardPipeline } from "../../src/onboard/pipeline.js";
import { AgentFs, HttpBackend } from "@nkmc/agent-fs";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";

/**
 * Full-chain integration tests: CLI command → AgentFs → registry → HttpBackend → HTTP server.
 *
 * Uses a local mock HTTP server for reliable, deterministic assertions.
 * Also includes real-network tests against free public APIs.
 */

// ── Local mock server: full-chain CLI → API test ─────────────────────

describe("CLI → API full-chain (local mock server)", () => {
  let mockServer: Server;
  let mockPort: number;
  let fs: AgentFs;

  // In-memory data store for the mock server
  const pets: Record<string, any> = {
    "1": { id: 1, name: "Buddy", status: "available" },
    "2": { id: 2, name: "Milo", status: "sold" },
  };

  beforeAll(async () => {
    // 1. Start a mock HTTP server that mimics a REST API with basePath /api/v2
    await new Promise<void>((resolve) => {
      mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://localhost`);
        const path = url.pathname;
        res.setHeader("Content-Type", "application/json");

        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

          // GET /api/v2/pet → list
          if (path === "/api/v2/pet" && req.method === "GET") {
            res.writeHead(200);
            res.end(JSON.stringify(Object.values(pets)));
            return;
          }

          // POST /api/v2/pet → create
          if (path === "/api/v2/pet" && req.method === "POST") {
            const id = String(body?.id ?? Date.now());
            pets[id] = { ...body, id: Number(id) };
            res.writeHead(201);
            res.end(JSON.stringify(pets[id]));
            return;
          }

          // GET/DELETE /api/v2/pet/{id}
          const match = path.match(/^\/api\/v2\/pet\/(\w+)$/);
          if (match && req.method === "GET") {
            const pet = pets[match[1]];
            if (pet) { res.writeHead(200); res.end(JSON.stringify(pet)); }
            else { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); }
            return;
          }
          if (match && req.method === "DELETE") {
            const existed = !!pets[match[1]];
            delete pets[match[1]];
            res.writeHead(existed ? 200 : 404);
            res.end(JSON.stringify({ deleted: existed }));
            return;
          }

          res.writeHead(404);
          res.end(JSON.stringify({ error: "Unknown route" }));
        });
      });
      mockServer.listen(0, () => {
        mockPort = (mockServer.address() as any).port;
        resolve();
      });
    });

    // 2. Create HttpBackend directly with correct http:// baseUrl + basePath
    //    This tests the full chain: cat/ls/write/rm CLI commands → AgentFs → HttpBackend → real HTTP
    const backend = new HttpBackend({
      baseUrl: `http://localhost:${mockPort}/api/v2`,
      resources: [{ name: "pet", apiPath: "/pet" }],
    });

    // 3. Mount directly into AgentFs
    fs = new AgentFs({ mounts: [{ path: "/mock-api", backend }] });
  });

  afterAll(() => {
    mockServer?.close();
  });

  it("ls: should list pet resource", async () => {
    const result = await fs.execute("ls /mock-api/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries).toContain("pet/");
  });

  it("ls resource: should list pet IDs from mock server", async () => {
    const result = await fs.execute("ls /mock-api/pet/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries).toContain("1.json");
    expect(entries).toContain("2.json");
  });

  it("cat: should read pet by ID with correct data", async () => {
    const result = await fs.execute("cat /mock-api/pet/1.json");
    expect(result.ok).toBe(true);
    const pet = result.data as Record<string, unknown>;
    expect(pet.id).toBe(1);
    expect(pet.name).toBe("Buddy");
    expect(pet.status).toBe("available");
  });

  it("write → cat round-trip: created pet is readable via cat", async () => {
    // write (POST): parseCommand → AgentFs → HttpBackend → mock server POST /api/v2/pet
    const writeResult = await fs.execute(
      `write /mock-api/pet/ ${JSON.stringify({ id: 42, name: "Nakamichi", status: "available" })}`,
    );
    expect(writeResult.ok).toBe(true);
    expect((writeResult.data as any).id).toBe("42");

    // cat (GET): parseCommand → AgentFs → HttpBackend → mock server GET /api/v2/pet/42
    const catResult = await fs.execute("cat /mock-api/pet/42.json");
    expect(catResult.ok).toBe(true);
    const pet = catResult.data as Record<string, unknown>;
    expect(pet.id).toBe(42);
    expect(pet.name).toBe("Nakamichi");
    expect(pet.status).toBe("available");
  });

  it("rm → cat: deleted pet is no longer readable", async () => {
    // rm (DELETE): parseCommand → AgentFs → HttpBackend → mock server DELETE /api/v2/pet/42
    const rmResult = await fs.execute("rm /mock-api/pet/42.json");
    expect(rmResult.ok).toBe(true);

    // cat after delete should fail with NotFoundError
    const catResult = await fs.execute("cat /mock-api/pet/42.json");
    expect(catResult.ok).toBe(false);
  });
});

// ── Petstore E2E (real network, demo API) ────────────────────────────

describe("Petstore E2E (real HTTP)", { timeout: 60_000 }, () => {
  let fs: AgentFs;
  const store = new MemoryRegistryStore();

  beforeAll(async () => {
    const pipeline = new OnboardPipeline({ store, smokeTest: false });
    const result = await pipeline.onboardOne({
      domain: "petstore3.swagger.io",
      specUrl: "https://petstore3.swagger.io/api/v3/openapi.json",
    });
    expect(result.status).toBe("ok");
    expect(result.endpoints).toBeGreaterThan(0);

    const { onMiss, listDomains } = createRegistryResolver({ store, wrapVirtualFiles: false });
    fs = new AgentFs({ mounts: [], onMiss, listDomains });
  });

  it("basePath should be /api/v3", async () => {
    const record = await store.get("petstore3.swagger.io");
    expect(record?.source?.basePath).toBe("/api/v3");
  });

  it("ls / should contain pet resource", async () => {
    const result = await fs.execute("ls /petstore3.swagger.io/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.includes("pet"))).toBe(true);
  });

  it("should have _api/ listing", async () => {
    const result = await fs.execute("ls /petstore3.swagger.io/_api/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries.length).toBeGreaterThan(0);
  });
});

// ── NWS Weather E2E (real network) ──────────────────────────────────

describe("NWS Weather E2E (real HTTP)", { timeout: 60_000 }, () => {
  let fs: AgentFs;
  const store = new MemoryRegistryStore();

  beforeAll(async () => {
    const pipeline = new OnboardPipeline({ store, smokeTest: false });
    const result = await pipeline.onboardOne({
      domain: "api.weather.gov",
      specUrl: "https://api.weather.gov/openapi.json",
    });
    expect(result.status).toBe("ok");
    expect(result.endpoints).toBeGreaterThan(0);

    const { onMiss, listDomains } = createRegistryResolver({ store, wrapVirtualFiles: false });
    fs = new AgentFs({ mounts: [], onMiss, listDomains });
  });

  it("ls / should contain resources", async () => {
    const result = await fs.execute("ls /api.weather.gov/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries.length).toBeGreaterThan(0);
  });

  it("should have _api/ listing", async () => {
    const result = await fs.execute("ls /api.weather.gov/_api/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries.length).toBeGreaterThan(0);
  });
});
