import { describe, it, expect } from "vitest";
import { AgentFs, MountResolver } from "@nkmc/agent-fs";
import { MemoryBackend } from "@nkmc/agent-fs/testing";
import type { Mount } from "@nkmc/agent-fs";

describe("Lazy mount loading", () => {
  it("MountResolver should call onMiss when no mount found", async () => {
    const resolver = new MountResolver();
    const dynamicBackend = new MemoryBackend();
    dynamicBackend.seed("products", [{ id: "1", name: "Widget" }]);

    let missCalled = false;
    resolver.onMiss = async (path: string) => {
      missCalled = true;
      const domain = path.split("/").filter(Boolean)[0];
      if (domain === "acme-store.com") {
        resolver.add({
          path: "/acme-store.com",
          backend: dynamicBackend,
        });
        return true;
      }
      return false;
    };

    const result = await resolver.resolveAsync(
      "/acme-store.com/products/1.json",
    );
    expect(missCalled).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.mount.path).toBe("/acme-store.com");
    expect(result!.relativePath).toBe("/products/1.json");
  });

  it("MountResolver should return null if onMiss returns false", async () => {
    const resolver = new MountResolver();
    resolver.onMiss = async () => false;

    const result = await resolver.resolveAsync("/unknown.com/test");
    expect(result).toBeNull();
  });

  it("MountResolver should not call onMiss when mount exists", async () => {
    const resolver = new MountResolver();
    const backend = new MemoryBackend();
    resolver.add({ path: "/existing", backend });

    let missCalled = false;
    resolver.onMiss = async () => {
      missCalled = true;
      return false;
    };

    const result = await resolver.resolveAsync("/existing/file.json");
    expect(missCalled).toBe(false);
    expect(result).not.toBeNull();
    expect(result!.mount.path).toBe("/existing");
  });

  it("MountResolver resolveAsync works without onMiss set", async () => {
    const resolver = new MountResolver();
    const result = await resolver.resolveAsync("/anything");
    expect(result).toBeNull();
  });

  it("AgentFs should use resolveAsync for lazy loading", async () => {
    const dynamicBackend = new MemoryBackend();
    dynamicBackend.seed("products", [{ id: "42", name: "Widget" }]);

    const fs = new AgentFs({
      mounts: [],
      onMiss: async (path, addMount) => {
        const domain = path.split("/").filter(Boolean)[0];
        if (domain === "acme-store.com") {
          addMount({ path: "/acme-store.com", backend: dynamicBackend });
          return true;
        }
        return false;
      },
    });

    const result = await fs.execute("cat /acme-store.com/products/42.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { name: string }).name).toBe("Widget");
    }
  });

  it("AgentFs ls / should include lazily-loaded domains", async () => {
    const staticBackend = new MemoryBackend();

    const fs = new AgentFs({
      mounts: [{ path: "/memory", backend: staticBackend }],
      listDomains: async () => ["acme-store.com", "stripe.com"],
    });

    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entries = result.data as string[];
      expect(entries).toContain("memory/");
      expect(entries).toContain("acme-store.com/");
      expect(entries).toContain("stripe.com/");
    }
  });

  it("AgentFs ls / should deduplicate static mounts and dynamic domains", async () => {
    const staticBackend = new MemoryBackend();

    const fs = new AgentFs({
      mounts: [{ path: "/acme-store.com", backend: staticBackend }],
      listDomains: async () => ["acme-store.com"],
    });

    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entries = result.data as string[];
      const acmeCount = entries.filter(
        (e: string) => e === "acme-store.com/",
      ).length;
      expect(acmeCount).toBe(1);
    }
  });

  it("AgentFs should return NO_MOUNT when onMiss returns false", async () => {
    const fs = new AgentFs({
      mounts: [],
      onMiss: async () => false,
    });

    const result = await fs.execute("cat /unknown.com/data");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_MOUNT");
    }
  });
});
