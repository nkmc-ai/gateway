/**
 * E2E integration test: Context7 API (real network).
 *
 * Requires CONTEXT7_API_KEY environment variable.
 * Skipped automatically when no API key is available.
 *
 * Run with: CONTEXT7_API_KEY=ctx7sk_xxx npx vitest run packages/gateway/test/registry/context7-e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { Context7Client } from "../../src/registry/context7.js";
import { Context7Backend } from "../../src/registry/context7-backend.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import { AgentFs } from "@nkmc/agent-fs";

const API_KEY = process.env.CONTEXT7_API_KEY;

describe.skipIf(!API_KEY)("Context7 Client E2E (real network)", () => {
  const client = new Context7Client({ apiKey: API_KEY });

  it("should search for React library", async () => {
    const results = await client.searchLibraries("react");
    expect(results.length).toBeGreaterThan(0);

    const react = results.find((r) => r.id.includes("react"));
    expect(react).toBeDefined();
    expect(react!.name).toBeTruthy();
  }, 15_000);

  it("should query React hooks documentation", async () => {
    const results = await client.searchLibraries("react");
    const react = results.find((r) => r.id.includes("facebook/react") || r.id.includes("react"));
    expect(react).toBeDefined();

    const docs = await client.queryDocs(react!.id, "useState hook");
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.toLowerCase()).toMatch(/react|hook|state|usestate/);
  }, 30_000);

  it("should search for Next.js library", async () => {
    const results = await client.searchLibraries("nextjs");
    expect(results.length).toBeGreaterThan(0);
  }, 15_000);
});

describe.skipIf(!API_KEY)("Context7 via AgentFs E2E (real network)", () => {
  const fs = new AgentFs({
    mounts: [
      { path: "/context7", backend: new Context7Backend({ apiKey: API_KEY }) },
    ],
    onMiss: async () => false,
    listDomains: async () => [],
  });

  it("ls / should show context7", async () => {
    const result = await fs.execute("ls /");
    expect(result.ok).toBe(true);
    expect(result.data).toContain("context7/");
  });

  it("ls /context7/ should show usage hints", async () => {
    const result = await fs.execute("ls /context7/");
    expect(result.ok).toBe(true);
    const entries = result.data as string[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.includes("grep"))).toBe(true);
  });

  it('grep "react" /context7/ should search libraries', async () => {
    const result = await fs.execute('grep "react" /context7/');
    expect(result.ok).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBeGreaterThan(0);
    expect(data.some((r: any) => r.id?.includes("react"))).toBe(true);
  }, 15_000);

  it("cat /context7/facebook/react should return overview docs", async () => {
    const result = await fs.execute("cat /context7/facebook/react");
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.libraryId).toBe("/facebook/react");
    expect(data.docs.length).toBeGreaterThan(0);
  }, 30_000);

  it('grep "useState" /context7/facebook/react should query specific docs', async () => {
    const result = await fs.execute('grep "useState" /context7/facebook/react');
    expect(result.ok).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBeGreaterThan(0);
    expect((data[0] as any).docs).toBeTruthy();
  }, 30_000);
});
