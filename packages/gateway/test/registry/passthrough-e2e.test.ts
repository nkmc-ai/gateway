/**
 * E2E integration test: HTTP Passthrough mode with real API.
 *
 * Registers a service with a bare skill.md (no Schema, no API sections),
 * causing HttpBackend to enter passthrough mode where all paths proxy
 * directly to the target API without resource/endpoint mapping.
 *
 * Uses JSONPlaceholder as the real API target.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { parseSkillMd } from "../../src/registry/skill-parser.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import { AgentFs } from "@nkmc/agent-fs";

const DOMAIN = "jsonplaceholder.typicode.com";

// Bare skill.md — no ## Schema, no ## API
// skillToHttpConfig will produce resources=[], endpoints=[] → passthrough mode
const BARE_SKILL_MD = `---
name: "JSONPlaceholder"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# JSONPlaceholder

Free fake REST API for testing. All paths proxy directly to the target.
`;

describe("HTTP Passthrough E2E: JSONPlaceholder (real network)", () => {
  let fs: AgentFs;

  beforeAll(async () => {
    const store = new MemoryRegistryStore();
    const record = parseSkillMd(DOMAIN, BARE_SKILL_MD);
    await store.put(DOMAIN, record);

    const { onMiss, listDomains, searchDomains } = createRegistryResolver({
      store,
      wrapVirtualFiles: true,
    });
    fs = new AgentFs({ mounts: [], onMiss, listDomains, searchDomains });
  });

  it("ls / should list the registered service", async () => {
    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    expect(result.data).toContain(`${DOMAIN}/`);
  });

  it("ls /domain/ should show only virtual files (no resources in passthrough)", async () => {
    const result = await fs.execute(`ls /${DOMAIN}/`);
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    // Passthrough root = empty from HttpBackend + virtual files from wrapper
    expect(entries).toContain("_pricing.json");
    expect(entries).toContain("_versions.json");
    // No resource directories — passthrough doesn't know them
    expect(entries).not.toContain("posts/");
  });

  it("ls /domain/posts should list real posts via direct proxy", async () => {
    const result = await fs.execute(`ls /${DOMAIN}/posts`);
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    // JSONPlaceholder has 100 posts, passthrough maps item.id to string
    expect(entries.length).toBe(100);
    expect(entries).toContain("1");
  }, 15_000);

  it("cat /domain/posts/1 should proxy GET and return real post", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/posts/1`);
    expect(result.ok).toBe(true);
    const post = result.data as any;
    expect(post.id).toBe(1);
    expect(post.userId).toBe(1);
    expect(post.title).toBeTruthy();
    expect(post.body).toBeTruthy();
  }, 10_000);

  it("cat /domain/users/3 should proxy GET and return real user", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/users/3`);
    expect(result.ok).toBe(true);
    const user = result.data as any;
    expect(user.id).toBe(3);
    expect(user.name).toBeTruthy();
    expect(user.email).toBeTruthy();
  }, 10_000);

  it("cat /domain/posts/1/comments should proxy nested path", async () => {
    const result = await fs.execute(`cat /${DOMAIN}/posts/1/comments`);
    expect(result.ok).toBe(true);
    const comments = result.data as any[];
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0].postId).toBe(1);
  }, 10_000);

  it("grep on /domain/posts should proxy search with ?q=", async () => {
    const result = await fs.execute(`grep "test" /${DOMAIN}/posts`);
    expect(result.ok).toBe(true);
    // JSONPlaceholder doesn't actually filter by ?q=, it returns all posts
    // But the proxy mechanism should work without error
    const data = result.data as any[];
    expect(Array.isArray(data)).toBe(true);
  }, 10_000);
});
