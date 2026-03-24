// packages/gateway/test/registry/skill-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseSkillMd, parsePricingAnnotation } from "../../src/registry/skill-parser.js";

const SAMPLE_SKILL_MD = `---
name: "Acme Store"
gateway: nkmc
version: "1.0"
roles:
  - agent
  - premium
---

# Acme Store

An e-commerce store for widgets.

## Schema

### products (読: public / 写: agent)

Product catalog.

| field | type | description |
|-------|------|-------------|
| id | string | Product ID |
| name | string | Product name |
| price | number | Price in USD |

## API

### List products

\`GET /api/products\` — 免費，public

Returns all products.

### Create order

\`POST /api/orders\` — 0.05 USDC / 次，agent

Creates a new order.
`;

describe("parseSkillMd", () => {
  it("should extract frontmatter fields", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.domain).toBe("acme-store.com");
    expect(result.name).toBe("Acme Store");
    expect(result.version).toBe("1.0");
    expect(result.roles).toEqual(["agent", "premium"]);
  });

  it("should extract description from first paragraph", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.description).toContain("e-commerce store");
  });

  it("should extract endpoint summaries from API section", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.endpoints).toHaveLength(2);
    expect(result.endpoints[0]).toMatchObject({
      method: "GET",
      path: "/api/products",
      description: "List products",
    });
    expect(result.endpoints[1]).toMatchObject({
      method: "POST",
      path: "/api/orders",
      description: "Create order",
    });
  });

  it("should extract pricing from endpoint annotation", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.endpoints[1].pricing).toEqual({
      cost: 0.05,
      currency: "USDC",
      per: "call",
    });
  });

  it("should not have pricing for free endpoints", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.endpoints[0].pricing).toBeUndefined();
  });

  it("should store the raw skill.md", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.skillMd).toBe(SAMPLE_SKILL_MD);
  });

  it("should default isFirstParty to false", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.isFirstParty).toBe(false);
  });

  it("should accept isFirstParty override", () => {
    const result = parseSkillMd("memory", SAMPLE_SKILL_MD, { isFirstParty: true });
    expect(result.isFirstParty).toBe(true);
    expect(result.domain).toBe("memory");
  });

  it("should handle minimal skill.md", () => {
    const minimal = `---\nname: "Minimal"\ngateway: nkmc\nversion: "0.1"\nroles: [agent]\n---\n\n# Minimal\n\nA minimal service.\n`;
    const result = parseSkillMd("minimal.com", minimal);
    expect(result.name).toBe("Minimal");
    expect(result.endpoints).toEqual([]);
    expect(result.description).toContain("minimal service");
  });

  it("should set status to active and isDefault to true", () => {
    const result = parseSkillMd("acme-store.com", SAMPLE_SKILL_MD);
    expect(result.status).toBe("active");
    expect(result.isDefault).toBe(true);
  });
});

describe("parsePricingAnnotation", () => {
  it("should parse USDC per call", () => {
    expect(parsePricingAnnotation("0.05 USDC / call")).toEqual({
      cost: 0.05,
      currency: "USDC",
      per: "call",
    });
  });

  it("should parse 次 as call", () => {
    expect(parsePricingAnnotation("0.05 USDC / 次")).toEqual({
      cost: 0.05,
      currency: "USDC",
      per: "call",
    });
  });

  it("should parse per byte", () => {
    expect(parsePricingAnnotation("0.001 ETH / byte")).toEqual({
      cost: 0.001,
      currency: "ETH",
      per: "byte",
    });
  });

  it("should return undefined for free text", () => {
    expect(parsePricingAnnotation("免費，public")).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(parsePricingAnnotation("")).toBeUndefined();
  });
});
