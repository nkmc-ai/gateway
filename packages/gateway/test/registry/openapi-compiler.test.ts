import { describe, it, expect } from "vitest";
import { compileOpenApiSpec, fetchAndCompile, extractBasePath } from "../../src/registry/openapi-compiler.js";

const PETSTORE_SPEC = {
  openapi: "3.0.0",
  info: { title: "Petstore", description: "A sample pet store", version: "1.0.0" },
  paths: {
    "/pets": {
      get: { summary: "List all pets", operationId: "listPets" },
      post: { summary: "Create a pet", operationId: "createPet" },
    },
    "/pets/{petId}": {
      get: { summary: "Get pet by ID", operationId: "getPet" },
      delete: { summary: "Delete a pet", operationId: "deletePet" },
    },
  },
};

describe("compileOpenApiSpec", () => {
  it("should extract service name and description from info", () => {
    const { record } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com" });
    expect(record.name).toBe("Petstore");
    expect(record.description).toBe("A sample pet store");
    expect(record.domain).toBe("petstore.com");
  });

  it("should extract endpoints from paths", () => {
    const { record } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com" });
    expect(record.endpoints).toHaveLength(4);
    expect(record.endpoints[0]).toMatchObject({ method: "GET", path: "/pets", description: "List all pets" });
    expect(record.endpoints[1]).toMatchObject({ method: "POST", path: "/pets" });
  });

  it("should infer resources from path patterns", () => {
    const { resources } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com" });
    expect(resources.length).toBeGreaterThanOrEqual(1);
    expect(resources[0].name).toBe("pets");
  });

  it("should generate skill.md with Schema and API sections", () => {
    const { skillMd } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com" });
    expect(skillMd).toContain("Petstore");
    expect(skillMd).toContain("## Schema");
    expect(skillMd).toContain("### pets (public)");
    expect(skillMd).toContain("## API");
  });

  it("should set source type to openapi", () => {
    const { record } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com" });
    expect(record.source?.type).toBe("openapi");
  });

  it("should use custom version", () => {
    const { record } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com", version: "2.0" });
    expect(record.version).toBe("2.0");
  });

  it("should set status and isDefault", () => {
    const { record } = compileOpenApiSpec(PETSTORE_SPEC, { domain: "petstore.com" });
    expect(record.status).toBe("active");
    expect(record.isDefault).toBe(true);
  });

  it("should handle empty spec", () => {
    const { record } = compileOpenApiSpec({}, { domain: "empty.com" });
    expect(record.name).toBe("empty.com");
    expect(record.endpoints).toEqual([]);
  });

  it("should extract basePath from servers[0].url", () => {
    const spec = {
      ...PETSTORE_SPEC,
      servers: [{ url: "https://petstore.com/api/v3" }],
    };
    const { record } = compileOpenApiSpec(spec, { domain: "petstore.com" });
    expect(record.source?.basePath).toBe("/api/v3");
  });

  it("should not set basePath when servers URL has no path", () => {
    const spec = {
      ...PETSTORE_SPEC,
      servers: [{ url: "https://api.github.com" }],
    };
    const { record } = compileOpenApiSpec(spec, { domain: "api.github.com" });
    expect(record.source?.basePath).toBeUndefined();
  });
});

describe("schema extraction", () => {
  const SPEC_WITH_SCHEMAS = {
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0.0" },
    components: {
      schemas: {
        Pet: {
          type: "object",
          required: ["name"],
          properties: {
            id: { type: "integer", description: "Pet ID" },
            name: { type: "string", description: "Pet name" },
            tag: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/pets": {
        get: {
          summary: "List pets",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" }, description: "Max items" },
            { name: "status", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "A list of pets",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
          },
        },
        post: {
          summary: "Create pet",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
          responses: {
            "201": { description: "Created" },
          },
        },
      },
      "/pets/{petId}": {
        get: {
          summary: "Get pet",
          parameters: [
            { name: "petId", in: "path", required: true, schema: { type: "string" } },
          ],
        },
      },
    },
  };

  it("should extract parameters from operations", () => {
    const { record } = compileOpenApiSpec(SPEC_WITH_SCHEMAS, { domain: "test.com" });
    const listPets = record.endpoints.find((e) => e.method === "GET" && e.path === "/pets");
    expect(listPets?.parameters).toHaveLength(2);
    expect(listPets?.parameters?.[0]).toMatchObject({
      name: "limit",
      in: "query",
      required: false,
      type: "integer",
      description: "Max items",
    });
    expect(listPets?.parameters?.[1]).toMatchObject({
      name: "status",
      in: "query",
      required: true,
      type: "string",
    });
  });

  it("should extract path parameters", () => {
    const { record } = compileOpenApiSpec(SPEC_WITH_SCHEMAS, { domain: "test.com" });
    const getPet = record.endpoints.find((e) => e.method === "GET" && e.path === "/pets/{petId}");
    expect(getPet?.parameters).toHaveLength(1);
    expect(getPet?.parameters?.[0]).toMatchObject({
      name: "petId",
      in: "path",
      required: true,
      type: "string",
    });
  });

  it("should extract requestBody with $ref resolution", () => {
    const { record } = compileOpenApiSpec(SPEC_WITH_SCHEMAS, { domain: "test.com" });
    const createPet = record.endpoints.find((e) => e.method === "POST" && e.path === "/pets");
    expect(createPet?.requestBody).toBeDefined();
    expect(createPet?.requestBody?.contentType).toBe("application/json");
    expect(createPet?.requestBody?.required).toBe(true);
    expect(createPet?.requestBody?.properties).toHaveLength(3);
    expect(createPet?.requestBody?.properties).toContainEqual({
      name: "name",
      type: "string",
      required: true,
      description: "Pet name",
    });
  });

  it("should extract 2xx responses with $ref resolution", () => {
    const { record } = compileOpenApiSpec(SPEC_WITH_SCHEMAS, { domain: "test.com" });
    const listPets = record.endpoints.find((e) => e.method === "GET" && e.path === "/pets");
    expect(listPets?.responses).toHaveLength(1);
    expect(listPets?.responses?.[0].status).toBe(200);
    expect(listPets?.responses?.[0].description).toBe("A list of pets");
    expect(listPets?.responses?.[0].properties).toHaveLength(3);
  });

  it("should include schema tables in generated skill.md", () => {
    const { skillMd } = compileOpenApiSpec(SPEC_WITH_SCHEMAS, { domain: "test.com" });
    // Parameters table
    expect(skillMd).toContain("**Parameters:**");
    expect(skillMd).toContain("| limit | query | integer |");
    expect(skillMd).toContain("| status | query | string | * |");
    // Request body table
    expect(skillMd).toContain("**Body** (application/json, required):");
    expect(skillMd).toContain("| name | string | * |");
    // Response
    expect(skillMd).toContain("**Response 200**: A list of pets");
    expect(skillMd).toContain("| id | integer |");
  });

  it("should not include schema fields when absent", () => {
    const { record } = compileOpenApiSpec({
      openapi: "3.0.0",
      info: { title: "Bare", version: "1.0.0" },
      paths: { "/health": { get: { summary: "Health check" } } },
    }, { domain: "bare.com" });
    const ep = record.endpoints[0];
    expect(ep.parameters).toBeUndefined();
    expect(ep.requestBody).toBeUndefined();
    expect(ep.responses).toBeUndefined();
  });
});

describe("fetchAndCompile", () => {
  it("should fetch and compile remote spec", async () => {
    const mockFetch = async (url: string) => {
      return new Response(JSON.stringify(PETSTORE_SPEC), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const result = await fetchAndCompile("https://petstore.com/openapi.json", { domain: "petstore.com" }, mockFetch as any);
    expect(result.record.name).toBe("Petstore");
    expect(result.record.source?.url).toBe("https://petstore.com/openapi.json");
  });

  it("should throw on failed fetch", async () => {
    const mockFetch = async () => new Response("Not found", { status: 404 });
    await expect(fetchAndCompile("https://bad.com/spec.json", { domain: "bad.com" }, mockFetch as any)).rejects.toThrow("Failed to fetch spec");
  });

  it("should preserve basePath from spec in fetchAndCompile", async () => {
    const specWithServers = {
      ...PETSTORE_SPEC,
      servers: [{ url: "https://api.stripe.com/v1" }],
    };
    const mockFetch = async () => {
      return new Response(JSON.stringify(specWithServers), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await fetchAndCompile(
      "https://api.stripe.com/openapi.json",
      { domain: "api.stripe.com" },
      mockFetch as any,
    );
    expect(result.record.source?.url).toBe("https://api.stripe.com/openapi.json");
    expect(result.record.source?.basePath).toBe("/v1");
  });
});
