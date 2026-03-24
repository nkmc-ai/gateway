import { describe, it, expect } from "vitest";
import { MountResolver } from "../src/mount.js";
import { MemoryBackend } from "../src/backends/memory.js";

function createMockBackend() {
  return new MemoryBackend();
}

describe("MountResolver", () => {
  it("should resolve a path to the correct mount", () => {
    const resolver = new MountResolver();
    const backend = createMockBackend();
    resolver.add({ path: "/db", backend });

    const result = resolver.resolve("/db/users/42.json");
    expect(result).not.toBeNull();
    expect(result!.mount.path).toBe("/db");
    expect(result!.relativePath).toBe("/users/42.json");
  });

  it("should return null for unmatched paths", () => {
    const resolver = new MountResolver();
    resolver.add({ path: "/db", backend: createMockBackend() });

    const result = resolver.resolve("/api/weather");
    expect(result).toBeNull();
  });

  it("should match the most specific mount", () => {
    const resolver = new MountResolver();
    const dbBackend = createMockBackend();
    const kvBackend = createMockBackend();
    resolver.add({ path: "/db", backend: dbBackend });
    resolver.add({ path: "/db/cache", backend: kvBackend });

    const result = resolver.resolve("/db/cache/key1");
    expect(result!.mount.backend).toBe(kvBackend);
    expect(result!.relativePath).toBe("/key1");
  });

  it("should check read permissions", () => {
    const resolver = new MountResolver();
    const mount = {
      path: "/db",
      backend: createMockBackend(),
      permissions: { read: ["premium"], write: ["admin"] },
    };
    resolver.add(mount);

    const denied = resolver.checkPermission(mount, "read", ["agent"]);
    expect(denied).not.toBeNull();
    expect(denied!.code).toBe("PERMISSION_DENIED");

    const allowed = resolver.checkPermission(mount, "read", ["premium"]);
    expect(allowed).toBeNull();
  });

  it("should check write permissions", () => {
    const resolver = new MountResolver();
    const mount = {
      path: "/db",
      backend: createMockBackend(),
      permissions: { read: ["agent"], write: ["admin"] },
    };
    resolver.add(mount);

    const denied = resolver.checkPermission(mount, "write", ["agent"]);
    expect(denied).not.toBeNull();

    const allowed = resolver.checkPermission(mount, "write", ["admin"]);
    expect(allowed).toBeNull();
  });

  it("should allow all if no permissions defined", () => {
    const resolver = new MountResolver();
    const mount = { path: "/db", backend: createMockBackend() };
    resolver.add(mount);

    const result = resolver.checkPermission(mount, "write", ["anyone"]);
    expect(result).toBeNull();
  });

  it("should list all mount paths", () => {
    const resolver = new MountResolver();
    resolver.add({ path: "/db", backend: createMockBackend() });
    resolver.add({ path: "/kv", backend: createMockBackend() });
    resolver.add({ path: "/queue", backend: createMockBackend() });

    const paths = resolver.listMounts();
    expect(paths).toContain("/db");
    expect(paths).toContain("/kv");
    expect(paths).toContain("/queue");
  });
});
