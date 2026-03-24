import { describe, it, expect, beforeEach } from "vitest";
import { AgentFs } from "@nkmc/agent-fs";
import { MemoryBackend } from "@nkmc/agent-fs/testing";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { parseSkillMd } from "../../src/registry/skill-parser.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";

const WEATHER_SKILL = `---
name: "Weather API"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Weather API

Real-time weather forecasts and historical data.

## API

### Get forecast

\`GET /api/forecast\` — 0.01 USDC / 次，agent

### Get history

\`GET /api/history\` — 0.02 USDC / 次，agent
`;

const STORE_SKILL = `---
name: "Acme Store"
gateway: nkmc
version: "2.0"
roles: [agent, premium]
---

# Acme Store

E-commerce platform for widgets and gadgets.

## Schema

### products (读: public / 写: agent)

All available products.

| field | type | description |
|-------|------|-------------|
| id | string | Product ID |
| name | string | Product name |
| price | number | Price in USD |

## API

### Create order

\`POST /api/orders\` — 0.05 USDC / 次，agent
`;

describe("Registry Integration", () => {
  let fs: AgentFs;
  let store: MemoryRegistryStore;

  beforeEach(async () => {
    store = new MemoryRegistryStore();

    await store.put(
      "weather-api.com",
      parseSkillMd("weather-api.com", WEATHER_SKILL),
    );
    await store.put(
      "acme-store.com",
      parseSkillMd("acme-store.com", STORE_SKILL),
    );

    const { onMiss, listDomains, searchDomains } =
      createRegistryResolver(store);
    const memoryBackend = new MemoryBackend();
    memoryBackend.seed("notes", [{ id: "1", text: "hello" }]);

    fs = new AgentFs({
      mounts: [{ path: "/memory", backend: memoryBackend }],
      onMiss,
      listDomains,
      searchDomains,
    });
  });

  it("ls / shows static mounts and registry services", async () => {
    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries).toContain("memory/");
    expect(entries).toContain("weather-api.com/");
    expect(entries).toContain("acme-store.com/");
  });

  it("grep on root searches across all registered services", async () => {
    const result = await fs.execute('grep "weather" /');
    expect(result.ok).toBe(true);
    const data = result.data as Array<{ domain: string }>;
    expect(data.some((d) => d.domain === "weather-api.com")).toBe(true);
  });

  it("grep on root returns empty for no match", async () => {
    const result = await fs.execute('grep "zzzznotfound" /');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("static mount still works normally", async () => {
    const result = await fs.execute("cat /memory/notes/1.json");
    expect(result.ok).toBe(true);
    expect((result.data as { text: string }).text).toBe("hello");
  });

  it("new service registration is immediately discoverable", async () => {
    const newSkill = `---\nname: "New Service"\ngateway: nkmc\nversion: "1.0"\nroles: [agent]\n---\n\n# New Service\n\nBrand new.\n`;
    await store.put(
      "new-service.com",
      parseSkillMd("new-service.com", newSkill),
    );

    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries).toContain("new-service.com/");
  });
});
