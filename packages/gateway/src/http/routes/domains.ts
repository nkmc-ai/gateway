import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { JWK } from "jose";
import { signPublishToken } from "@nkmc/core";
import type { D1Database } from "../../d1/types.js";
import { queryDnsTxt } from "../lib/dns.js";

export interface DomainRouteOptions {
  db: D1Database;
  gatewayPrivateKey: JWK;
}

interface ChallengeRow {
  domain: string;
  challenge_code: string;
  status: string;
  created_at: number;
  verified_at: number | null;
  expires_at: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isValidDomain(domain: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(domain);
}

export function domainRoutes(options: DomainRouteOptions) {
  const { db, gatewayPrivateKey } = options;
  const app = new Hono();

  // Request a DNS challenge for domain ownership
  app.post("/challenge", async (c) => {
    const body = await c.req.json<{ domain: string }>().catch(() => null);
    const domain = body?.domain;

    if (!domain || !isValidDomain(domain)) {
      return c.json({ error: "Invalid or missing domain" }, 400);
    }

    const now = Date.now();

    // Already verified and not expired → no new challenge needed
    const verified = await db
      .prepare(
        "SELECT * FROM domain_challenges WHERE domain = ? AND status = 'verified' AND expires_at > ?",
      )
      .bind(domain, now)
      .first<ChallengeRow>();

    if (verified) {
      return c.json(
        {
          error: "Domain already verified. Use `nkmc claim <domain> --verify` to renew your token.",
          expiresAt: verified.expires_at,
        },
        409,
      );
    }

    // Check for existing unexpired pending challenge
    const existing = await db
      .prepare(
        "SELECT * FROM domain_challenges WHERE domain = ? AND status = 'pending' AND expires_at > ?",
      )
      .bind(domain, now)
      .first<ChallengeRow>();

    if (existing) {
      return c.json({
        domain,
        txtRecord: `_nkmc.${domain}`,
        txtValue: `nkmc-verify=${existing.challenge_code}`,
        expiresAt: existing.expires_at,
      });
    }

    // Generate new challenge (also covers expired verified domains)
    const challengeCode = nanoid(32);
    const expiresAt = now + SEVEN_DAYS_MS;

    await db
      .prepare(
        `INSERT OR REPLACE INTO domain_challenges (domain, challenge_code, status, created_at, expires_at)
         VALUES (?, ?, 'pending', ?, ?)`,
      )
      .bind(domain, challengeCode, now, expiresAt)
      .run();

    return c.json({
      domain,
      txtRecord: `_nkmc.${domain}`,
      txtValue: `nkmc-verify=${challengeCode}`,
      expiresAt,
    });
  });

  // Verify DNS record and issue publish token
  app.post("/verify", async (c) => {
    const body = await c.req.json<{ domain: string }>().catch(() => null);
    const domain = body?.domain;

    if (!domain || !isValidDomain(domain)) {
      return c.json({ error: "Invalid or missing domain" }, 400);
    }

    const now = Date.now();

    // 1. Already verified and not expired → issue new token without DNS check
    const verified = await db
      .prepare(
        "SELECT * FROM domain_challenges WHERE domain = ? AND status = 'verified' AND expires_at > ?",
      )
      .bind(domain, now)
      .first<ChallengeRow>();

    if (verified) {
      const publishToken = await signPublishToken(gatewayPrivateKey, domain);
      return c.json({ ok: true, domain, publishToken });
    }

    // 2. Pending challenge → verify DNS
    const challenge = await db
      .prepare(
        "SELECT * FROM domain_challenges WHERE domain = ? AND status = 'pending' AND expires_at > ?",
      )
      .bind(domain, now)
      .first<ChallengeRow>();

    if (!challenge) {
      return c.json(
        { error: "No pending challenge found. Run `nkmc claim <domain>` first." },
        404,
      );
    }

    // Query DNS TXT records
    const expectedValue = `nkmc-verify=${challenge.challenge_code}`;
    let txtRecords: string[];
    try {
      txtRecords = await queryDnsTxt(`_nkmc.${domain}`);
    } catch {
      return c.json(
        { error: "Failed to query DNS. Please try again later." },
        502,
      );
    }

    if (!txtRecords.includes(expectedValue)) {
      return c.json(
        {
          error: `DNS TXT record not found. Expected TXT record on _nkmc.${domain} with value "${expectedValue}". DNS propagation can take up to 5 minutes.`,
        },
        422,
      );
    }

    // Mark as verified (ownership valid for 1 year)
    await db
      .prepare(
        "UPDATE domain_challenges SET status = 'verified', verified_at = ?, expires_at = ? WHERE domain = ?",
      )
      .bind(now, now + ONE_YEAR_MS, domain)
      .run();

    // Sign publish token (24h expiry, scoped to domain)
    const publishToken = await signPublishToken(gatewayPrivateKey, domain);

    return c.json({ ok: true, domain, publishToken });
  });

  return app;
}
