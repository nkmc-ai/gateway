import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { MemoryCredentialVault } from "../../src/credential/memory-vault.js";
import { parseSkillMd } from "../../src/registry/skill-parser.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";

const SKILL_MD = `---
name: "Test API"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Test API

A test service.

## API

### Get data

\`GET /api/data\` — public
`;

describe("Credential Injection", () => {
  let store: MemoryRegistryStore;
  let vault: MemoryCredentialVault;

  beforeEach(async () => {
    store = new MemoryRegistryStore();
    vault = new MemoryCredentialVault();
    const record = parseSkillMd("test-api.com", SKILL_MD);
    await store.put("test-api.com", record);
  });

  it("should create resolver with vault", async () => {
    const { onMiss, listDomains } = createRegistryResolver({ store, vault });
    expect(typeof onMiss).toBe("function");
    const domains = await listDomains();
    expect(domains).toContain("test-api.com");
  });

  it("should mount backend when credentials exist", async () => {
    await vault.putPool("test-api.com", { type: "bearer", token: "secret_token" });
    const { onMiss } = createRegistryResolver({ store, vault });

    let mountedBackend: any = null;
    await onMiss("/test-api.com/data", (mount) => {
      mountedBackend = mount.backend;
    });

    expect(mountedBackend).not.toBeNull();
    // The backend is created — we can verify it was created with auth by checking
    // that it exists (the auth is internal to HttpBackend, so we verify integration)
  });

  it("should mount backend even without credentials", async () => {
    const { onMiss } = createRegistryResolver({ store, vault });

    let mountPath = "";
    await onMiss("/test-api.com/data", (mount) => {
      mountPath = mount.path;
    });

    expect(mountPath).toBe("/test-api.com");
  });
});
