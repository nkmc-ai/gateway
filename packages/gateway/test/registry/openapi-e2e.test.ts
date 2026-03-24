/**
 * E2E integration test: OpenAPI → Registry → AgentFs → Real HTTP
 *
 * Uses JSONPlaceholder (https://jsonplaceholder.typicode.com) as a real, public REST API.
 * These tests require network access and will be slower than unit tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { compileOpenApiSpec, fetchAndCompile } from "../../src/registry/openapi-compiler.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import { AgentFs } from "@nkmc/agent-fs";

const DOMAIN = "jsonplaceholder.typicode.com";

const JSONPLACEHOLDER_SPEC = {
  openapi: "3.0.0",
  info: {
    title: "JSONPlaceholder",
    version: "1.0.0",
    description: "Free fake REST API for testing and prototyping.",
  },
  paths: {
    "/posts": {
      get: { summary: "List all posts", operationId: "listPosts" },
      post: { summary: "Create a post", operationId: "createPost" },
    },
    "/posts/{id}": {
      get: { summary: "Get post by ID", operationId: "getPost" },
    },
    "/users": {
      get: { summary: "List all users", operationId: "listUsers" },
    },
    "/users/{id}": {
      get: { summary: "Get user by ID", operationId: "getUser" },
    },
    "/comments": {
      get: { summary: "List all comments", operationId: "listComments" },
    },
  },
};

describe("OpenAPI E2E: JSONPlaceholder (real network)", () => {
  let fs: AgentFs;
  let store: MemoryRegistryStore;

  beforeAll(async () => {
    // 1. Compile OpenAPI spec → ServiceRecord
    const { record } = compileOpenApiSpec(JSONPLACEHOLDER_SPEC, {
      domain: DOMAIN,
    });

    // 2. Register in store
    store = new MemoryRegistryStore();
    await store.put(DOMAIN, record);

    // 3. Create AgentFs with registry resolver
    const { onMiss, listDomains, searchDomains } = createRegistryResolver({
      store,
      wrapVirtualFiles: true,
    });
    fs = new AgentFs({ mounts: [], onMiss, listDomains, searchDomains });
  });

  it("ls / should list the registered service", async () => {
    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries).toContain(`${DOMAIN}/`);
  });

  it("ls /domain/ should list resources, _api, and virtual files", async () => {
    const result = await fs.execute(`ls /${DOMAIN}/`);
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    // Resources from Schema section
    expect(entries).toContain("posts/");
    expect(entries).toContain("users/");
    expect(entries).toContain("comments/");
    // API endpoints directory
    expect(entries).toContain("_api/");
    // Virtual files from VirtualFileBackend
    expect(entries).toContain("_pricing.json");
    expect(entries).toContain("_versions.json");
  }, 10_000);

  it("ls /domain/posts/ should list real posts from the API", async () => {
    const result = await fs.execute(`ls /${DOMAIN}/posts/`);
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    // JSONPlaceholder has 100 posts
    expect(entries.length).toBe(100);
    expect(entries).toContain("1.json");
    expect(entries).toContain("100.json");
  }, 15_000);

  it("cat /domain/posts/1 should return real post data", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/posts/1`);
    expect(result.ok).toBe(true);
    const post = result.data as any;
    expect(post.id).toBe(1);
    expect(post.userId).toBe(1);
    expect(post.title).toBeTruthy();
    expect(post.body).toBeTruthy();
  }, 10_000);

  it("cat /domain/users/1 should return real user data", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/users/1`);
    expect(result.ok).toBe(true);
    const user = result.data as any;
    expect(user.id).toBe(1);
    expect(user.name).toBeTruthy();
    expect(user.email).toBeTruthy();
  }, 10_000);

  it("ls /domain/_api/ should list all endpoints", async () => {
    const result = await fs.execute(`ls /${DOMAIN}/_api/`);
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries.length).toBe(6);
    expect(entries.some((e) => e.includes("list-all-posts"))).toBe(true);
    expect(entries.some((e) => e.includes("list-all-users"))).toBe(true);
  }, 10_000);

  it("cat /domain/_pricing.json should return pricing info", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/_pricing.json`);
    expect(result.ok).toBe(true);
  });

  it("cat /domain/_versions.json should return version info", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/_versions.json`);
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.domain).toBe(DOMAIN);
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].version).toBe("1.0.0");
  });
});

describe("fetchAndCompile with real Petstore spec", () => {
  it("should fetch and compile the Petstore OpenAPI spec", async () => {
    const result = await fetchAndCompile(
      "https://petstore3.swagger.io/api/v3/openapi.json",
      { domain: "petstore3.swagger.io" },
    );

    expect(result.record.name).toBeTruthy();
    expect(result.record.endpoints.length).toBeGreaterThan(0);
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.record.source?.type).toBe("openapi");
    expect(result.record.source?.url).toBe("https://petstore3.swagger.io/api/v3/openapi.json");
    expect(result.skillMd).toContain("## Schema");
    expect(result.skillMd).toContain("## API");
  }, 15_000);
});
