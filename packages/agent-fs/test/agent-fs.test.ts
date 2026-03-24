import { describe, it, expect, beforeEach } from "vitest";
import { AgentFs } from "../src/agent-fs.js";
import { MemoryBackend } from "../src/backends/memory.js";
import type { FsCommand } from "../src/types.js";

describe("AgentFs", () => {
  let fs: AgentFs;
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
    backend.seed("users", [
      { id: "1", name: "Alice", status: "active" },
      { id: "2", name: "Bob", status: "inactive" },
    ]);
    backend.seed("products", [
      { id: "1", name: "Widget", price: 9.99 },
    ]);

    fs = new AgentFs({
      mounts: [{ path: "/db", backend }],
    });
  });

  describe("execute (string commands)", () => {
    it("should execute ls /", async () => {
      const result = await fs.execute("ls /");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(["db/"]);
      }
    });

    it("should execute ls /db/", async () => {
      const result = await fs.execute("ls /db/");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entries = result.data as string[];
        expect(entries).toContain("users/");
        expect(entries).toContain("products/");
      }
    });

    it("should execute ls /db/users/", async () => {
      const result = await fs.execute("ls /db/users/");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entries = result.data as string[];
        expect(entries).toContain("1.json");
        expect(entries).toContain("2.json");
      }
    });

    it("should execute cat /db/users/1.json", async () => {
      const result = await fs.execute("cat /db/users/1.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ id: "1", name: "Alice", status: "active" });
      }
    });

    it("should execute write to create", async () => {
      const result = await fs.execute(
        'write /db/users/ \'{"name":"Charlie","status":"active"}\'',
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const { id } = result.data as { id: string };
        const read = await fs.execute(`cat /db/users/${id}.json`);
        expect(read.ok).toBe(true);
        if (read.ok) {
          expect((read.data as { name: string }).name).toBe("Charlie");
        }
      }
    });

    it("should execute write to update", async () => {
      const result = await fs.execute(
        'write /db/users/1.json \'{"name":"Alice Updated"}\'',
      );
      expect(result.ok).toBe(true);

      const read = await fs.execute("cat /db/users/1.json");
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect((read.data as { name: string }).name).toBe("Alice Updated");
      }
    });

    it("should execute rm", async () => {
      const result = await fs.execute("rm /db/users/2.json");
      expect(result.ok).toBe(true);

      const list = await fs.execute("ls /db/users/");
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.data).not.toContain("2.json");
      }
    });

    it("should execute grep", async () => {
      const result = await fs.execute('grep "Alice" /db/users/');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const matches = result.data as { name: string }[];
        expect(matches).toHaveLength(1);
        expect(matches[0].name).toBe("Alice");
      }
    });

    it("should handle nk prefix", async () => {
      const result = await fs.execute("nk ls /db/users/");
      expect(result.ok).toBe(true);
    });

    it("should return NOT_FOUND for missing record", async () => {
      const result = await fs.execute("cat /db/users/999.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("should return NO_MOUNT for unknown path", async () => {
      const result = await fs.execute("ls /unknown/");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NO_MOUNT");
      }
    });
  });

  describe("permissions", () => {
    it("should deny access when role is insufficient", async () => {
      const restrictedFs = new AgentFs({
        mounts: [
          {
            path: "/db",
            backend,
            permissions: { read: ["premium"], write: ["admin"] },
          },
        ],
      });

      const result = await restrictedFs.execute("ls /db/users/", ["agent"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PERMISSION_DENIED");
      }
    });

    it("should allow access with correct role", async () => {
      const restrictedFs = new AgentFs({
        mounts: [
          {
            path: "/db",
            backend,
            permissions: { read: ["premium"], write: ["admin"] },
          },
        ],
      });

      const result = await restrictedFs.execute("ls /db/users/", ["premium"]);
      expect(result.ok).toBe(true);
    });

    it("should check write permission for rm", async () => {
      const restrictedFs = new AgentFs({
        mounts: [
          {
            path: "/db",
            backend,
            permissions: { read: ["agent"], write: ["admin"] },
          },
        ],
      });

      const result = await restrictedFs.execute("rm /db/users/1.json", [
        "agent",
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PERMISSION_DENIED");
      }
    });
  });

  describe("searchEndpoints hook", () => {
    it("should use searchEndpoints for domain-level grep", async () => {
      const mockEndpoints = [
        { method: "GET", path: "/alerts/active", description: "Active alerts" },
        { method: "GET", path: "/alerts/{id}", description: "Single alert" },
      ];
      const searchEndpoints = async (_domain: string, _query: string) => mockEndpoints;

      const fsWithHook = new AgentFs({
        mounts: [{ path: "/db", backend }],
        searchEndpoints,
      });

      const result = await fsWithHook.execute('grep "alerts" /api.weather.gov/');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(mockEndpoints);
      }
    });

    it("should pass correct domain and query to searchEndpoints", async () => {
      let capturedDomain = "";
      let capturedQuery = "";
      const searchEndpoints = async (domain: string, query: string) => {
        capturedDomain = domain;
        capturedQuery = query;
        return [];
      };

      const fsWithHook = new AgentFs({
        mounts: [{ path: "/db", backend }],
        searchEndpoints,
      });

      await fsWithHook.execute('grep "weather" /api.example.com/');
      expect(capturedDomain).toBe("api.example.com");
      expect(capturedQuery).toBe("weather");
    });

    it("should not use searchEndpoints for deep paths", async () => {
      let hookCalled = false;
      const searchEndpoints = async () => {
        hookCalled = true;
        return [];
      };

      const fsWithHook = new AgentFs({
        mounts: [{ path: "/db", backend }],
        searchEndpoints,
      });

      // Deep path like /db/users/ should go to backend.search(), not searchEndpoints
      const result = await fsWithHook.execute('grep "Alice" /db/users/');
      expect(result.ok).toBe(true);
      expect(hookCalled).toBe(false);
    });

    it("should still use searchDomains for root grep", async () => {
      const mockDomainResults = [{ domain: "test.com", name: "Test" }];
      const searchDomains = async () => mockDomainResults;
      let endpointHookCalled = false;
      const searchEndpoints = async () => {
        endpointHookCalled = true;
        return [];
      };

      const fsWithHook = new AgentFs({
        mounts: [{ path: "/db", backend }],
        searchDomains,
        searchEndpoints,
      });

      const result = await fsWithHook.execute('grep "test" /');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(mockDomainResults);
      }
      expect(endpointHookCalled).toBe(false);
    });

    it("should return empty array when searchEndpoints returns nothing", async () => {
      const searchEndpoints = async () => [];
      const fsWithHook = new AgentFs({
        mounts: [{ path: "/db", backend }],
        searchEndpoints,
      });

      const result = await fsWithHook.execute('grep "zzz" /some-domain.com/');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe("multiple mounts", () => {
    it("should route to correct backend", async () => {
      const kvBackend = new MemoryBackend();
      kvBackend.seed("session", [{ id: "abc", token: "xyz" }]);

      const multiFs = new AgentFs({
        mounts: [
          { path: "/db", backend },
          { path: "/kv", backend: kvBackend },
        ],
      });

      const dbResult = await multiFs.execute("cat /db/users/1.json");
      expect(dbResult.ok).toBe(true);
      if (dbResult.ok) {
        expect((dbResult.data as { name: string }).name).toBe("Alice");
      }

      const kvResult = await multiFs.execute("cat /kv/session/abc.json");
      expect(kvResult.ok).toBe(true);
      if (kvResult.ok) {
        expect((kvResult.data as { token: string }).token).toBe("xyz");
      }
    });

    it("should list all mounts at root", async () => {
      const multiFs = new AgentFs({
        mounts: [
          { path: "/db", backend },
          { path: "/kv", backend: new MemoryBackend() },
        ],
      });

      const result = await multiFs.execute("ls /");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entries = result.data as string[];
        expect(entries).toContain("db/");
        expect(entries).toContain("kv/");
      }
    });
  });
});
