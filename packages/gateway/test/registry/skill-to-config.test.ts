// packages/gateway/test/registry/skill-to-config.test.ts
import { describe, it, expect } from "vitest";
import { skillToHttpConfig } from "../../src/registry/skill-to-config.js";
import type { ServiceRecord } from "../../src/registry/types.js";

function makeRecord(domain: string, skillMd: string): ServiceRecord {
  return {
    domain,
    name: domain,
    description: "test",
    version: "1.0",
    roles: ["agent"],
    skillMd,
    endpoints: [],
    isFirstParty: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
    isDefault: true,
  };
}

describe("skillToHttpConfig", () => {
  it("should set baseUrl from domain with https", () => {
    const record = makeRecord("acme-store.com", `---
name: "Acme"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme

Test.

## API

### List products

\`GET /api/products\` — 免费，public
`);
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://acme-store.com");
  });

  it("should create endpoints from API section", () => {
    const record = makeRecord("acme-store.com", `---
name: "Acme"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme

Test.

## API

### List products

\`GET /api/products\` — 免费，public

### Create order

\`POST /api/orders\` — 0.05 USDC / 次，agent
`);
    const config = skillToHttpConfig(record);
    expect(config.endpoints).toHaveLength(2);
    expect(config.endpoints![0]).toEqual({
      name: "list-products",
      method: "GET",
      apiPath: "/api/products",
      description: "List products",
    });
    expect(config.endpoints![1]).toEqual({
      name: "create-order",
      method: "POST",
      apiPath: "/api/orders",
      description: "Create order",
    });
  });

  it("should create resources from Schema section", () => {
    const record = makeRecord("acme-store.com", `---
name: "Acme"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme

Test.

## Schema

### products (読: public / 写: agent)

Product catalog.

| field | type | description |
|-------|------|-------------|
| id | string | Product ID |
| name | string | Product name |
`);
    const config = skillToHttpConfig(record);
    expect(config.resources).toHaveLength(1);
    expect(config.resources![0].name).toBe("products");
    expect(config.resources![0].apiPath).toBe("/products");
    expect(config.resources![0].fields).toEqual([
      { name: "id", type: "string", description: "Product ID" },
      { name: "name", type: "string", description: "Product name" },
    ]);
  });

  it("should include basePath in baseUrl when source has basePath", () => {
    const record = makeRecord("api.cloudflare.com", `---
name: "Cloudflare"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Cloudflare

Test.
`);
    record.source = { type: "openapi", basePath: "/client/v4" };
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://api.cloudflare.com/client/v4");
  });

  it("should handle skill.md with no schema or api", () => {
    const record = makeRecord("simple.com", `---
name: "Simple"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Simple

A simple service.
`);
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://simple.com");
    expect(config.resources).toEqual([]);
    expect(config.endpoints).toEqual([]);
  });
});
