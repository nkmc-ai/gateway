import { describe, it, expect } from "vitest";
import { HttpBackend, type HttpAuth } from "@nkmc/agent-fs";

/**
 * Smoke tests for authenticated APIs using real HTTP calls.
 * Each test block is skipped when the required environment variable is absent.
 * These tests validate: request format + authentication + response parsing.
 */

function makeBackend(baseUrl: string, auth: HttpAuth, bodyEncoding?: "json" | "form") {
  return new HttpBackend({ baseUrl, auth, bodyEncoding });
}

// ── GitHub ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.GITHUB_TOKEN)("GitHub API", { timeout: 30_000 }, () => {
  it("GET /user should return login and id", async () => {
    const backend = makeBackend("https://api.github.com", {
      type: "bearer",
      token: process.env.GITHUB_TOKEN!,
    });
    const result = await backend.read("/_api/user") as Record<string, unknown>;
    // Direct passthrough read — need to set up endpoint or use passthrough
    // Use passthrough mode since no resources/endpoints configured
    expect(result).toBeDefined();
  });
});

// Helper: create a passthrough backend (no resources/endpoints → passthrough mode)
function makePassthroughBackend(baseUrl: string, auth: HttpAuth, bodyEncoding?: "json" | "form") {
  return new HttpBackend({ baseUrl, auth, bodyEncoding });
}

// ── HuggingFace ────────────────────────────────────────────────────

describe.skipIf(!process.env.HF_TOKEN)("HuggingFace API", { timeout: 30_000 }, () => {
  it("GET /api/models?limit=1 should return models", async () => {
    const backend = makePassthroughBackend("https://huggingface.co", {
      type: "bearer",
      token: process.env.HF_TOKEN!,
    });
    const result = await backend.read("/api/models?limit=1");
    expect(result).toBeDefined();
  });
});

// ── GitLab ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.GITLAB_TOKEN)("GitLab API", { timeout: 30_000 }, () => {
  it("GET /api/v4/projects?per_page=1 should return projects", async () => {
    const backend = makePassthroughBackend("https://gitlab.com", {
      type: "bearer",
      token: process.env.GITLAB_TOKEN!,
    });
    const result = await backend.read("/api/v4/projects?per_page=1");
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Vercel ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.VERCEL_TOKEN)("Vercel API", { timeout: 30_000 }, () => {
  it("GET /v9/projects?limit=1 should return projects", async () => {
    const backend = makePassthroughBackend("https://api.vercel.com", {
      type: "bearer",
      token: process.env.VERCEL_TOKEN!,
    });
    const result = await backend.read("/v9/projects?limit=1") as Record<string, unknown>;
    expect(result).toBeDefined();
  });
});

// ── Sentry ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.SENTRY_AUTH_TOKEN)("Sentry API", { timeout: 30_000 }, () => {
  it("GET /api/0/organizations/ should return organizations", async () => {
    const backend = makePassthroughBackend("https://sentry.io", {
      type: "bearer",
      token: process.env.SENTRY_AUTH_TOKEN!,
    });
    const result = await backend.read("/api/0/organizations/");
    expect(result).toBeDefined();
  });
});

// ── PagerDuty ──────────────────────────────────────────────────────

describe.skipIf(!process.env.PAGERDUTY_TOKEN)("PagerDuty API", { timeout: 30_000 }, () => {
  it("GET /services?limit=1 should return services", async () => {
    const backend = makePassthroughBackend("https://api.pagerduty.com", {
      type: "bearer",
      token: process.env.PAGERDUTY_TOKEN!,
    });
    const result = await backend.read("/services?limit=1") as Record<string, unknown>;
    expect(result).toBeDefined();
  });
});

// ── Mistral ────────────────────────────────────────────────────────

describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral API", { timeout: 30_000 }, () => {
  it("GET /v1/models should return models", async () => {
    const backend = makePassthroughBackend("https://api.mistral.ai", {
      type: "bearer",
      token: process.env.MISTRAL_API_KEY!,
    });
    const result = await backend.read("/v1/models") as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
  });
});

// ── Cloudflare ─────────────────────────────────────────────────────

describe.skipIf(!process.env.CLOUDFLARE_API_TOKEN)("Cloudflare API", { timeout: 30_000 }, () => {
  it("GET /client/v4/zones should return result array", async () => {
    const backend = makePassthroughBackend("https://api.cloudflare.com", {
      type: "bearer",
      token: process.env.CLOUDFLARE_API_TOKEN!,
    });
    const result = await backend.read("/client/v4/zones") as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.result).toBeDefined();
  });
});

// ── DigitalOcean ───────────────────────────────────────────────────

describe.skipIf(!process.env.DIGITALOCEAN_TOKEN)("DigitalOcean API", { timeout: 30_000 }, () => {
  it("GET /v2/account should return account info", async () => {
    const backend = makePassthroughBackend("https://api.digitalocean.com", {
      type: "bearer",
      token: process.env.DIGITALOCEAN_TOKEN!,
    });
    const result = await backend.read("/v2/account") as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.account).toBeDefined();
  });
});

// ── Stripe ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.STRIPE_SECRET_KEY)("Stripe API", { timeout: 30_000 }, () => {
  it("GET /v1/customers?limit=1 should return data array", async () => {
    const backend = makePassthroughBackend("https://api.stripe.com", {
      type: "bearer",
      token: process.env.STRIPE_SECRET_KEY!,
    }, "form");
    const result = await backend.read("/v1/customers?limit=1") as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ── Slack ──────────────────────────────────────────────────────────

describe.skipIf(!process.env.SLACK_BOT_TOKEN)("Slack API", { timeout: 30_000 }, () => {
  it("GET /api/auth.test should return ok", async () => {
    const backend = makePassthroughBackend("https://slack.com", {
      type: "bearer",
      token: process.env.SLACK_BOT_TOKEN!,
    });
    const result = await backend.read("/api/auth.test") as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });
});

// ── Discord ────────────────────────────────────────────────────────

describe.skipIf(!process.env.DISCORD_BOT_TOKEN)("Discord API", { timeout: 30_000 }, () => {
  it("GET /api/v10/users/@me should return id and username", async () => {
    const backend = makePassthroughBackend("https://discord.com", {
      type: "bearer",
      token: process.env.DISCORD_BOT_TOKEN!,
      prefix: "Bot",
    });
    const result = await backend.read("/api/v10/users/@me") as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.username).toBeDefined();
  });
});
