import { describe, it, expect } from "vitest";
import { compileOpenApiSpec, extractBasePath } from "../../src/registry/openapi-compiler.js";
import { skillToHttpConfig } from "../../src/registry/skill-to-config.js";
import type { ServiceRecord } from "../../src/registry/types.js";

// --- basePath extraction ---

describe("extractBasePath", () => {
  it("Cloudflare: should extract /client/v4", () => {
    const spec = { servers: [{ url: "https://api.cloudflare.com/client/v4" }] };
    expect(extractBasePath(spec)).toBe("/client/v4");
  });

  it("Slack: should extract /api", () => {
    const spec = { servers: [{ url: "https://slack.com/api" }] };
    expect(extractBasePath(spec)).toBe("/api");
  });

  it("Stripe: should extract /v1", () => {
    const spec = { servers: [{ url: "https://api.stripe.com/v1" }] };
    expect(extractBasePath(spec)).toBe("/v1");
  });

  it("Petstore: should extract /api/v3", () => {
    const spec = { servers: [{ url: "https://petstore3.swagger.io/api/v3" }] };
    expect(extractBasePath(spec)).toBe("/api/v3");
  });

  it("GitHub: should return empty string (no path)", () => {
    const spec = { servers: [{ url: "https://api.github.com" }] };
    expect(extractBasePath(spec)).toBe("");
  });

  it("should return empty string when no servers field", () => {
    expect(extractBasePath({})).toBe("");
    expect(extractBasePath({ servers: [] })).toBe("");
  });

  it("should handle relative URL", () => {
    const spec = { servers: [{ url: "/api/v2" }] };
    expect(extractBasePath(spec)).toBe("/api/v2");
  });

  it("should strip trailing slash", () => {
    const spec = { servers: [{ url: "https://example.com/api/" }] };
    expect(extractBasePath(spec)).toBe("/api");
  });

  it("should handle root path URL", () => {
    const spec = { servers: [{ url: "https://example.com/" }] };
    expect(extractBasePath(spec)).toBe("");
  });
});

// --- basePath stored in compiled record ---

describe("compileOpenApiSpec basePath", () => {
  it("should store basePath in source config when present", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      servers: [{ url: "https://api.cloudflare.com/client/v4" }],
      paths: {},
    };
    const { record } = compileOpenApiSpec(spec, { domain: "api.cloudflare.com" });
    expect(record.source?.basePath).toBe("/client/v4");
  });

  it("should not include basePath when path is empty", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      servers: [{ url: "https://api.github.com" }],
      paths: {},
    };
    const { record } = compileOpenApiSpec(spec, { domain: "api.github.com" });
    expect(record.source?.basePath).toBeUndefined();
  });
});

// --- baseUrl → HttpBackendConfig ---

describe("skillToHttpConfig with basePath", () => {
  function makeRecord(domain: string, basePath?: string): ServiceRecord {
    return {
      domain,
      name: domain,
      description: "test",
      version: "1.0",
      roles: ["agent"],
      skillMd: `---\nname: "${domain}"\ngateway: nkmc\nversion: "1.0"\nroles: [agent]\n---\n\n# ${domain}\n\nTest.\n`,
      endpoints: [],
      isFirstParty: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
      isDefault: true,
      source: { type: "openapi", ...(basePath ? { basePath } : {}) },
    };
  }

  it("should include basePath in baseUrl when present", () => {
    const record = makeRecord("api.cloudflare.com", "/client/v4");
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://api.cloudflare.com/client/v4");
  });

  it("should include /api basePath for Slack", () => {
    const record = makeRecord("slack.com", "/api");
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://slack.com/api");
  });

  it("should include /v1 basePath for Stripe", () => {
    const record = makeRecord("api.stripe.com", "/v1");
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://api.stripe.com/v1");
  });

  it("should not append anything when no basePath", () => {
    const record = makeRecord("api.github.com");
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://api.github.com");
  });

  it("should not append anything when no source", () => {
    const record = makeRecord("simple.com");
    delete (record as any).source;
    const config = skillToHttpConfig(record);
    expect(config.baseUrl).toBe("https://simple.com");
  });
});
