/**
 * E2E: Onboard real major APIs from the internet, verify they compile
 * and become browsable via AgentFs.
 *
 * This test makes REAL network calls to fetch OpenAPI specs.
 * It does NOT call the actual APIs (no auth needed).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { OnboardPipeline } from "../../src/onboard/pipeline.js";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import { AgentFs } from "@nkmc/agent-fs";
import { ALL_APIS, FREE_APIS, RPC_APIS } from "../../src/onboard/manifest.js";
import type { OnboardReport, OnboardResult } from "../../src/onboard/types.js";

// ── Helper ────────────────────────────────────────────────────────────

function printReport(report: OnboardReport) {
  const summary = `Total: ${report.total} | OK: ${report.ok} | Failed: ${report.failed} | Skipped: ${report.skipped} | ${report.durationMs}ms`;
  console.log(`\n${"─".repeat(60)}`);
  console.log(summary);
  console.log(`${"─".repeat(60)}`);
  for (const r of report.results) {
    const icon = r.status === "ok" ? "✓" : r.status === "failed" ? "✗" : "○";
    const info = r.status === "ok"
      ? `${r.endpoints} endpoints, ${r.resources} resources (${r.durationMs}ms)`
      : r.error ?? "skipped";
    console.log(`  ${icon} ${r.domain.padEnd(30)} ${info}`);
  }
  console.log();
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Real API Onboarding (network)", () => {
  let store: MemoryRegistryStore;
  let pipeline: OnboardPipeline;
  let report: OnboardReport;

  beforeAll(async () => {
    store = new MemoryRegistryStore();
    pipeline = new OnboardPipeline({
      store,
      smokeTest: false,
      concurrency: 3,
    });

    // Strip auth — we only need to fetch & compile specs, not call APIs
    const entries = ALL_APIS.map((e) => ({ ...e, auth: undefined }));
    report = await pipeline.onboardMany(entries);
    printReport(report);
  }, 120_000);

  it("should onboard majority of APIs successfully", () => {
    // Allow some failures (network issues, spec changes), but most should work
    expect(report.ok).toBeGreaterThanOrEqual(Math.floor(report.total * 0.6));
  });

  it("should compile specs with endpoints", () => {
    const successful = report.results.filter((r) => r.status === "ok");
    for (const r of successful) {
      expect(r.endpoints).toBeGreaterThan(0);
    }
  });

  it("should compile specs with resources", () => {
    const successful = report.results.filter((r) => r.status === "ok");
    const withResources = successful.filter((r) => r.resources > 0);
    // Most OpenAPI specs should infer at least 1 resource
    expect(withResources.length).toBeGreaterThanOrEqual(
      Math.floor(successful.length * 0.5),
    );
  });

  it("should register all successful services in store", async () => {
    const services = await store.list();
    expect(services.length).toBe(report.ok);
  });

  // ── Per-service verification ──────────────────────────────────────

  describe("Individual API verification", () => {
    const knownApis = [
      { domain: "petstore3.swagger.io", minEndpoints: 10 },
      { domain: "api.weather.gov", minEndpoints: 5 },
      { domain: "api.github.com", minEndpoints: 100 },
      { domain: "api.stripe.com", minEndpoints: 50 },
      { domain: "api.cloudflare.com", minEndpoints: 50 },
      { domain: "discord.com", minEndpoints: 20 },
      { domain: "slack.com", minEndpoints: 50 },
      { domain: "api.digitalocean.com", minEndpoints: 30 },
      { domain: "sentry.io", minEndpoints: 20 },
      { domain: "api.vercel.com", minEndpoints: 10 },
      { domain: "api.mistral.ai", minEndpoints: 3 },
      { domain: "api.openai.com", minEndpoints: 10 },
      { domain: "api.twilio.com", minEndpoints: 50 },
      { domain: "api.resend.com", minEndpoints: 10 },
      // Batch 2
      { domain: "openrouter.ai", minEndpoints: 3 },
      { domain: "fly.io", minEndpoints: 20 },
      { domain: "api.render.com", minEndpoints: 30 },
      { domain: "api.notion.com", minEndpoints: 5 },
      { domain: "app.asana.com", minEndpoints: 50 },
      { domain: "circleci.com", minEndpoints: 30 },
      { domain: "api.datadoghq.com", minEndpoints: 100 },
      // Batch 3
      { domain: "en.wikipedia.org", minEndpoints: 20 },
      { domain: "jira.atlassian.com", minEndpoints: 100 },
      { domain: "api.spotify.com", minEndpoints: 30 },
      { domain: "api.getpostman.com", minEndpoints: 10 },
      { domain: "api.supabase.com", minEndpoints: 30 },
      { domain: "api.turso.tech", minEndpoints: 10 },
      { domain: "console.neon.tech", minEndpoints: 20 },
    ];

    for (const { domain, minEndpoints } of knownApis) {
      it(`${domain}: should have >= ${minEndpoints} endpoints`, () => {
        const r = report.results.find((r) => r.domain === domain);
        if (!r || r.status !== "ok") {
          // Skip if network fetch failed — don't fail the whole suite
          console.warn(`  ⚠ ${domain} was not onboarded (${r?.error ?? "missing"})`);
          return;
        }
        expect(r.endpoints).toBeGreaterThanOrEqual(minEndpoints);
      });
    }

    // ── RPC services (all use the shared EVM_METHODS with 13 methods) ──

    const rpcApis = RPC_APIS.map((e) => e.domain);

    for (const domain of rpcApis) {
      it(`${domain}: should be onboarded as jsonrpc with >= 13 endpoints`, () => {
        const r = report.results.find((r) => r.domain === domain);
        expect(r).toBeDefined();
        expect(r!.status).toBe("ok");
        expect(r!.source).toBe("jsonrpc");
        expect(r!.endpoints).toBeGreaterThanOrEqual(13);
      });

      it(`${domain}: should have source.rpc metadata in store`, async () => {
        const record = await store.get(domain);
        expect(record).not.toBeNull();
        expect(record!.source?.type).toBe("jsonrpc");
        expect(record!.source?.rpc).toBeDefined();
        expect(record!.source!.rpc!.convention).toBe("evm");
        expect(record!.source!.rpc!.resources.length).toBeGreaterThan(0);
      });
    }
  });

  // ── AgentFs browsing ──────────────────────────────────────────────

  describe("AgentFs browsing after onboard", () => {
    let fs: AgentFs;

    beforeAll(() => {
      const { onMiss, listDomains } = createRegistryResolver({
        store,
        wrapVirtualFiles: false,
      });
      fs = new AgentFs({ mounts: [], onMiss, listDomains });
    });

    it("ls / should list all onboarded domains", async () => {
      const result = await fs.execute("ls /");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      // At least the free APIs should be listed
      for (const api of FREE_APIS) {
        if (report.results.find((r) => r.domain === api.domain && r.status === "ok")) {
          expect(entries).toContain(`${api.domain}/`);
        }
      }
    });

    it("ls /petstore3.swagger.io/ should show pet resources", async () => {
      const r = report.results.find((r) => r.domain === "petstore3.swagger.io");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /petstore3.swagger.io/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.some((e) => e.includes("pet"))).toBe(true);
      expect(entries).toContain("_api/");
    });

    it("ls /api.github.com/ should show repo-related resources", async () => {
      const r = report.results.find((r) => r.domain === "api.github.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.github.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.some((e) => e.includes("repos"))).toBe(true);
    });

    it("ls /api.stripe.com/ should show payment resources", async () => {
      const r = report.results.find((r) => r.domain === "api.stripe.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.stripe.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /api.cloudflare.com/ should show zone/dns resources", async () => {
      const r = report.results.find((r) => r.domain === "api.cloudflare.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.cloudflare.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.some((e) => e.includes("zone"))).toBe(true);
    });

    it("ls /api.openai.com/ should show AI resources", async () => {
      const r = report.results.find((r) => r.domain === "api.openai.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.openai.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries).toContain("_api/");
    });

    it("ls /api.twilio.com/ should show communication resources", async () => {
      const r = report.results.find((r) => r.domain === "api.twilio.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.twilio.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries).toContain("_api/");
    });

    it("ls /api.resend.com/ should show email resources", async () => {
      const r = report.results.find((r) => r.domain === "api.resend.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.resend.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.includes("email") || e.includes("domain"))).toBe(true);
    });

    // ── Batch 2 browsing ──────────────────────────────────────────────

    it("ls /openrouter.ai/ should show AI gateway resources", async () => {
      const r = report.results.find((r) => r.domain === "openrouter.ai");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /openrouter.ai/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries).toContain("_api/");
    });

    it("ls /fly.io/ should show deployment resources", async () => {
      const r = report.results.find((r) => r.domain === "fly.io");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /fly.io/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.includes("app"))).toBe(true);
    });

    it("ls /api.render.com/ should show service resources", async () => {
      const r = report.results.find((r) => r.domain === "api.render.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.render.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /api.notion.com/ should show productivity resources", async () => {
      const r = report.results.find((r) => r.domain === "api.notion.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.notion.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /app.asana.com/ should show project management resources", async () => {
      const r = report.results.find((r) => r.domain === "app.asana.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /app.asana.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /circleci.com/ should show CI/CD resources", async () => {
      const r = report.results.find((r) => r.domain === "circleci.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /circleci.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /api.datadoghq.com/ should show monitoring resources", async () => {
      const r = report.results.find((r) => r.domain === "api.datadoghq.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.datadoghq.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    // ── Batch 3 browsing ──────────────────────────────────────────────

    it("ls /en.wikipedia.org/ should show knowledge resources", async () => {
      const r = report.results.find((r) => r.domain === "en.wikipedia.org");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /en.wikipedia.org/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /jira.atlassian.com/ should show project resources", async () => {
      const r = report.results.find((r) => r.domain === "jira.atlassian.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /jira.atlassian.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /api.spotify.com/ should show music resources", async () => {
      const r = report.results.find((r) => r.domain === "api.spotify.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.spotify.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /api.supabase.com/ should show database resources", async () => {
      const r = report.results.find((r) => r.domain === "api.supabase.com");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.supabase.com/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    it("ls /console.neon.tech/ should show database resources", async () => {
      const r = report.results.find((r) => r.domain === "console.neon.tech");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /console.neon.tech/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });

    // ── RPC service browsing ──────────────────────────────────────────

    for (const api of RPC_APIS) {
      it(`ls /${api.domain}/ should show EVM resources`, async () => {
        const result = await fs.execute(`ls /${api.domain}/`);
        expect(result.ok).toBe(true);
        const entries = result.data as string[];
        // All EVM services should expose blocks, balances, transactions
        expect(entries).toContain("blocks/");
        expect(entries).toContain("balances/");
        expect(entries).toContain("transactions/");
      });
    }
  });

  // ── Live HTTP test for free APIs ──────────────────────────────────

  describe("Live HTTP calls to free APIs", () => {
    let fs: AgentFs;

    beforeAll(() => {
      const { onMiss, listDomains } = createRegistryResolver({
        store,
        wrapVirtualFiles: false,
      });
      fs = new AgentFs({ mounts: [], onMiss, listDomains });
    });

    it("should fetch real data from Petstore API via AgentFs", async () => {
      const r = report.results.find((r) => r.domain === "petstore3.swagger.io");
      if (!r || r.status !== "ok") return;

      // List the _api directory to see available endpoints
      const apiList = await fs.execute("ls /petstore3.swagger.io/_api/");
      expect(apiList.ok).toBe(true);
      const apiEntries = apiList.data as string[];
      expect(apiEntries.length).toBeGreaterThan(0);
    });

    it("should fetch weather alerts from NWS API via AgentFs", async () => {
      const r = report.results.find((r) => r.domain === "api.weather.gov");
      if (!r || r.status !== "ok") return;

      const result = await fs.execute("ls /api.weather.gov/");
      expect(result.ok).toBe(true);
      const entries = result.data as string[];
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  // ── Live RPC calls to free blockchain providers ────────────────────
  // Free public RPC endpoints may have rate limits, geo-restrictions,
  // or occasional downtime.  We test at least ONE provider end-to-end
  // and treat individual provider failures as non-fatal warnings.

  describe("Live RPC calls to free blockchain APIs", () => {
    let fs: AgentFs;

    // Free RPC providers that need no API key
    const freeRpcDomains = RPC_APIS
      .filter((e) => e.tags?.includes("free"))
      .map((e) => e.domain);

    const lsResults = new Map<string, string[]>();

    beforeAll(() => {
      const { onMiss, listDomains } = createRegistryResolver({
        store,
        wrapVirtualFiles: false,
      });
      fs = new AgentFs({ mounts: [], onMiss, listDomains });
    });

    for (const domain of freeRpcDomains) {
      it(`${domain}: ls blocks/ should return recent block numbers`, async () => {
        const result = await fs.execute(`ls /${domain}/blocks/`);
        if (!result.ok) {
          console.warn(`  ⚠ ${domain}: ls blocks/ failed (rate limit or network) — skipping`);
          return;
        }
        const entries = result.data as string[];
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0]).toMatch(/\.json$/);
        lsResults.set(domain, entries);
      });

      it(`${domain}: cat blocks/{id}.json should return block data`, async () => {
        const entries = lsResults.get(domain);
        if (!entries || entries.length === 0) {
          console.warn(`  ⚠ ${domain}: skipping cat (no blocks from ls)`);
          return;
        }

        const result = await fs.execute(`cat /${domain}/blocks/${entries[0]}`);
        if (!result.ok) {
          console.warn(`  ⚠ ${domain}: cat blocks/ failed (rate limit or network) — skipping`);
          return;
        }
        expect(result.data).toBeDefined();
      });
    }

    it("at least one free RPC provider should be fully reachable", () => {
      expect(lsResults.size).toBeGreaterThan(0);
    });
  });
}, 120_000);
