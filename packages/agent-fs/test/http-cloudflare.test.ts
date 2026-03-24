import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import {
  HttpBackend,
  type HttpBackendConfig,
  type HttpResource,
} from "../src/backends/http.js";

// --- Mock Cloudflare API data ---

interface MockRecord {
  id: string;
  [key: string]: unknown;
}

const zones: MockRecord[] = [
  { id: "z1", name: "example.com", status: "active" },
  { id: "z2", name: "test.dev", status: "active" },
];

const dnsRecords: Record<string, MockRecord[]> = {
  z1: [
    { id: "r1", type: "A", name: "example.com", content: "1.2.3.4" },
    { id: "r2", type: "CNAME", name: "www.example.com", content: "example.com" },
  ],
  z2: [
    { id: "r3", type: "A", name: "test.dev", content: "5.6.7.8" },
  ],
};

const zoneSettings: Record<string, MockRecord[]> = {
  z1: [
    { id: "ssl", value: "full" },
    { id: "minify", value: "on" },
  ],
};

const workerScripts: MockRecord[] = [
  { id: "my-worker", script: "addEventListener('fetch', ...)" },
  { id: "api-gateway", script: "export default { fetch() {} }" },
];

const kvNamespaces: MockRecord[] = [
  { id: "ns1", title: "MY_KV" },
  { id: "ns2", title: "SESSIONS" },
];

const kvKeys: Record<string, MockRecord[]> = {
  ns1: [
    { name: "user:1", metadata: {} },
    { name: "user:2", metadata: {} },
  ],
  ns2: [
    { name: "sess:abc", metadata: {} },
  ],
};

const r2Buckets: MockRecord[] = [
  { name: "assets", creation_date: "2024-01-01" },
  { name: "backups", creation_date: "2024-06-01" },
];

// --- Mock Cloudflare API server ---

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function cfResult(data: unknown) {
  return { result: data, success: true };
}

function createMockCfServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      // Verify auth (Cloudflare uses Bearer token)
      const auth = req.headers.authorization;
      if (auth !== "Bearer cf-test-token") {
        json(res, 401, { success: false, errors: [{ message: "Unauthorized" }] });
        return;
      }

      // Read body
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined;

        // --- Zones ---
        // GET /zones
        if (path === "/zones" && method === "GET") {
          return json(res, 200, cfResult(zones));
        }
        // POST /zones
        if (path === "/zones" && method === "POST") {
          const newZone = { id: `z${zones.length + 1}`, ...body };
          zones.push(newZone);
          return json(res, 201, newZone);
        }
        // GET/DELETE /zones/:id
        const zoneMatch = path.match(/^\/zones\/([^/]+)$/);
        if (zoneMatch) {
          const [, zoneId] = zoneMatch;
          if (method === "GET") {
            const zone = zones.find((z) => z.id === zoneId);
            if (!zone) return json(res, 404, { success: false });
            return json(res, 200, zone);
          }
          if (method === "DELETE") {
            const idx = zones.findIndex((z) => z.id === zoneId);
            if (idx === -1) return json(res, 404, { success: false });
            zones.splice(idx, 1);
            return json(res, 200, { id: zoneId });
          }
        }

        // --- DNS Records (nested under zones) ---
        // GET /zones/:id/dns_records
        const dnsListMatch = path.match(/^\/zones\/([^/]+)\/dns_records$/);
        if (dnsListMatch && method === "GET") {
          const [, zoneId] = dnsListMatch;
          const records = dnsRecords[zoneId] ?? [];
          return json(res, 200, cfResult(records));
        }
        // POST /zones/:id/dns_records
        if (dnsListMatch && method === "POST") {
          const [, zoneId] = dnsListMatch;
          if (!dnsRecords[zoneId]) dnsRecords[zoneId] = [];
          const newRecord = { id: `r${Date.now()}`, ...body };
          dnsRecords[zoneId].push(newRecord);
          return json(res, 201, newRecord);
        }
        // GET/PUT/DELETE /zones/:id/dns_records/:rid
        const dnsItemMatch = path.match(/^\/zones\/([^/]+)\/dns_records\/([^/]+)$/);
        if (dnsItemMatch) {
          const [, zoneId, recordId] = dnsItemMatch;
          const records = dnsRecords[zoneId] ?? [];
          if (method === "GET") {
            const record = records.find((r) => r.id === recordId);
            if (!record) return json(res, 404, { success: false });
            return json(res, 200, record);
          }
          if (method === "PUT") {
            const idx = records.findIndex((r) => r.id === recordId);
            if (idx === -1) return json(res, 404, { success: false });
            records[idx] = { ...records[idx], ...body, id: recordId };
            return json(res, 200, records[idx]);
          }
          if (method === "DELETE") {
            const idx = records.findIndex((r) => r.id === recordId);
            if (idx === -1) return json(res, 404, { success: false });
            records.splice(idx, 1);
            return json(res, 200, { id: recordId });
          }
        }

        // --- Zone Settings (nested under zones) ---
        const settingsListMatch = path.match(/^\/zones\/([^/]+)\/settings$/);
        if (settingsListMatch && method === "GET") {
          const [, zoneId] = settingsListMatch;
          const settings = zoneSettings[zoneId] ?? [];
          return json(res, 200, cfResult(settings));
        }
        const settingsItemMatch = path.match(/^\/zones\/([^/]+)\/settings\/([^/]+)$/);
        if (settingsItemMatch && method === "GET") {
          const [, zoneId, settingId] = settingsItemMatch;
          const settings = zoneSettings[zoneId] ?? [];
          const setting = settings.find((s) => s.id === settingId);
          if (!setting) return json(res, 404, { success: false });
          return json(res, 200, setting);
        }

        // --- Workers Scripts (account-scoped) ---
        const workersMatch = path.match(/^\/accounts\/([^/]+)\/workers\/scripts$/);
        if (workersMatch && method === "GET") {
          return json(res, 200, cfResult(workerScripts));
        }

        // --- KV Namespaces (account-scoped) ---
        const kvNsMatch = path.match(/^\/accounts\/([^/]+)\/storage\/kv\/namespaces$/);
        if (kvNsMatch && method === "GET") {
          return json(res, 200, cfResult(kvNamespaces));
        }

        // --- KV Keys (deeply nested) ---
        const kvKeysMatch = path.match(
          /^\/accounts\/([^/]+)\/storage\/kv\/namespaces\/([^/]+)\/keys$/,
        );
        if (kvKeysMatch && method === "GET") {
          const [, , nsId] = kvKeysMatch;
          const keys = kvKeys[nsId] ?? [];
          return json(res, 200, cfResult(keys));
        }

        // --- R2 Buckets (account-scoped) ---
        const r2Match = path.match(/^\/accounts\/([^/]+)\/r2\/buckets$/);
        if (r2Match && method === "GET") {
          return json(res, 200, cfResult(r2Buckets));
        }

        json(res, 404, { success: false, errors: [{ message: "Not found" }] });
      });
    });

    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://localhost:${port}` });
    });
  });
}

// --- Cloudflare resource configuration ---

function createCfResources(): HttpResource[] {
  return [
    {
      name: "zones",
      listKey: "result",
      children: [
        {
          name: "dns_records",
          listKey: "result",
        },
        {
          name: "settings",
          listKey: "result",
        },
      ],
    },
    {
      name: "workers_scripts",
      apiPath: "/accounts/:accountId/workers/scripts",
      listKey: "result",
    },
    {
      name: "kv_namespaces",
      apiPath: "/accounts/:accountId/storage/kv/namespaces",
      listKey: "result",
      children: [
        {
          name: "keys",
          listKey: "result",
          idField: "name",
        },
      ],
    },
    {
      name: "r2_buckets",
      apiPath: "/accounts/:accountId/r2/buckets",
      listKey: "result",
      idField: "name",
    },
  ];
}

// --- Tests ---

describe("HttpBackend — Cloudflare nested resources", () => {
  let server: Server;
  let backend: HttpBackend;

  beforeAll(async () => {
    const mock = await createMockCfServer();
    server = mock.server;

    backend = new HttpBackend({
      baseUrl: mock.baseUrl,
      auth: { type: "bearer", token: "cf-test-token" },
      resources: createCfResources(),
      params: { accountId: "acct-123" },
    });
  });

  afterAll(
    () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  );

  // --- Root listing ---

  describe("root listing", () => {
    it("should list all top-level resources", async () => {
      const result = await backend.list("/");
      expect(result).toEqual([
        "zones/",
        "workers_scripts/",
        "kv_namespaces/",
        "r2_buckets/",
      ]);
    });
  });

  // --- Flat resource CRUD (zones) ---

  describe("flat resource CRUD — zones", () => {
    it("should list zones", async () => {
      const result = await backend.list("/zones/");
      expect(result).toContain("z1.json");
      expect(result).toContain("z2.json");
    });

    it("should read a single zone", async () => {
      const result = (await backend.read("/zones/z1.json")) as { name: string };
      expect(result.name).toBe("example.com");
    });

    it("should create a zone", async () => {
      const result = await backend.write("/zones/", {
        name: "new-zone.io",
        status: "pending",
      });
      expect(result.id).toBeDefined();
    });

    it("should delete a zone", async () => {
      // Delete the zone we just created
      const list = await backend.list("/zones/");
      const lastZone = list[list.length - 1].replace(".json", "");
      await backend.remove(`/zones/${lastZone}.json`);
      const listAfter = await backend.list("/zones/");
      expect(listAfter).not.toContain(`${lastZone}.json`);
    });
  });

  // --- Nested resource CRUD (zones/z1/dns_records) ---

  describe("nested resource CRUD — dns_records", () => {
    it("should list DNS records under a zone", async () => {
      const result = await backend.list("/zones/z1/dns_records/");
      expect(result).toContain("r1.json");
      expect(result).toContain("r2.json");
    });

    it("should read a single DNS record", async () => {
      const result = (await backend.read("/zones/z1/dns_records/r1.json")) as {
        type: string;
        content: string;
      };
      expect(result.type).toBe("A");
      expect(result.content).toBe("1.2.3.4");
    });

    it("should create a DNS record", async () => {
      const result = await backend.write("/zones/z1/dns_records/", {
        type: "MX",
        name: "example.com",
        content: "mail.example.com",
      });
      expect(result.id).toBeDefined();
    });

    it("should update a DNS record", async () => {
      const result = await backend.write("/zones/z1/dns_records/r1.json", {
        content: "10.0.0.1",
      });
      expect(result.id).toBe("r1");

      const updated = (await backend.read("/zones/z1/dns_records/r1.json")) as {
        content: string;
      };
      expect(updated.content).toBe("10.0.0.1");
    });

    it("should delete a DNS record", async () => {
      await backend.remove("/zones/z1/dns_records/r2.json");
      const list = await backend.list("/zones/z1/dns_records/");
      expect(list).not.toContain("r2.json");
    });

    it("should list DNS records under a different zone", async () => {
      const result = await backend.list("/zones/z2/dns_records/");
      expect(result).toContain("r3.json");
    });
  });

  // --- Intermediate node directory listing ---

  describe("intermediate node listing", () => {
    it("should list child resources of a zone", async () => {
      const result = await backend.list("/zones/z1/");
      expect(result).toEqual(["dns_records/", "settings/"]);
    });
  });

  // --- Account-scoped resources ---

  describe("account-scoped resources", () => {
    it("should list worker scripts", async () => {
      const result = await backend.list("/workers_scripts/");
      expect(result).toContain("my-worker.json");
      expect(result).toContain("api-gateway.json");
    });

    it("should list R2 buckets", async () => {
      const result = await backend.list("/r2_buckets/");
      expect(result).toContain("assets.json");
      expect(result).toContain("backups.json");
    });

    it("should list KV namespaces", async () => {
      const result = await backend.list("/kv_namespaces/");
      expect(result).toContain("ns1.json");
      expect(result).toContain("ns2.json");
    });
  });

  // --- Deep nesting (kv_namespaces/ns1/keys) ---

  describe("deep nesting — KV keys", () => {
    it("should list keys in a KV namespace", async () => {
      const result = await backend.list("/kv_namespaces/ns1/keys/");
      expect(result).toContain("user:1.json");
      expect(result).toContain("user:2.json");
    });

    it("should list keys in another KV namespace", async () => {
      const result = await backend.list("/kv_namespaces/ns2/keys/");
      expect(result).toContain("sess:abc.json");
    });

    it("should list child resources of a KV namespace", async () => {
      const result = await backend.list("/kv_namespaces/ns1/");
      expect(result).toEqual(["keys/"]);
    });
  });

  // --- Static param injection ---

  describe("static param injection", () => {
    it("should resolve :accountId in API paths", async () => {
      // The workers_scripts resource uses apiPath "/accounts/:accountId/workers/scripts"
      // With params { accountId: "acct-123" }, it should resolve to the correct URL
      // If this fails, the mock server won't match and we'd get an error
      const result = await backend.list("/workers_scripts/");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should resolve params for deeply nested account-scoped resources", async () => {
      const result = await backend.list("/kv_namespaces/ns1/keys/");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // --- Auth pass-through ---

  describe("auth pass-through", () => {
    it("should fail with wrong auth token", async () => {
      const badBackend = new HttpBackend({
        baseUrl: `http://localhost:${(server.address() as { port: number }).port}`,
        auth: { type: "bearer", token: "wrong-token" },
        resources: createCfResources(),
        params: { accountId: "acct-123" },
      });

      // The mock returns 401 and non-array body, list returns []
      const result = await badBackend.list("/zones/");
      expect(result).toEqual([]);
    });
  });

  // --- Zone settings (second child resource) ---

  describe("zone settings", () => {
    it("should list settings for a zone", async () => {
      const result = await backend.list("/zones/z1/settings/");
      expect(result).toContain("ssl.json");
      expect(result).toContain("minify.json");
    });

    it("should read a single setting", async () => {
      const result = (await backend.read("/zones/z1/settings/ssl.json")) as {
        id: string;
        value: string;
      };
      expect(result.id).toBe("ssl");
      expect(result.value).toBe("full");
    });
  });

  // --- AgentFs integration ---

  describe("AgentFs integration", () => {
    it("should work as a mount in AgentFs", async () => {
      const { AgentFs } = await import("../src/agent-fs.js");

      const agentFs = new AgentFs({
        mounts: [{ path: "/cf", backend }],
      });

      // List mount root
      const lsRoot = await agentFs.execute("ls /");
      expect(lsRoot.ok).toBe(true);
      if (lsRoot.ok) {
        expect(lsRoot.data).toContain("cf/");
      }

      // List resources
      const lsCf = await agentFs.execute("ls /cf/");
      expect(lsCf.ok).toBe(true);
      if (lsCf.ok) {
        expect(lsCf.data).toContain("zones/");
      }

      // List zones
      const lsZones = await agentFs.execute("ls /cf/zones/");
      expect(lsZones.ok).toBe(true);
      if (lsZones.ok) {
        expect((lsZones.data as string[]).some((e) => e.endsWith(".json"))).toBe(true);
      }

      // Read a zone
      const catZone = await agentFs.execute("cat /cf/zones/z1.json");
      expect(catZone.ok).toBe(true);
      if (catZone.ok) {
        expect((catZone.data as { name: string }).name).toBe("example.com");
      }

      // Navigate nested resource
      const lsDns = await agentFs.execute("ls /cf/zones/z1/dns_records/");
      expect(lsDns.ok).toBe(true);
      if (lsDns.ok) {
        expect((lsDns.data as string[]).some((e) => e.endsWith(".json"))).toBe(true);
      }
    });
  });
});
