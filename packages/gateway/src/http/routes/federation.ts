import { Hono } from "hono";
import type { AgentFs } from "@nkmc/agent-fs";
import type { PeerStore } from "../../federation/types.js";
import type { CredentialVault } from "../../credential/types.js";
import type { Env } from "../app.js";

export interface FederationRouteOptions {
  peerStore: PeerStore;
  vault: CredentialVault;
  agentFs: AgentFs;
}

/**
 * Verify that the request comes from a known peer.
 * Returns the peer ID or null if auth fails.
 */
async function authenticatePeer(
  peerStore: PeerStore,
  peerId: string | undefined,
  authHeader: string | undefined,
): ReturnType<typeof peerStore.getPeer> {
  if (!peerId || !authHeader) return null;

  const peer = await peerStore.getPeer(peerId);
  if (!peer || peer.status !== "active") return null;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== peer.sharedSecret) return null;

  return peer;
}

/**
 * Extract the domain from a command string.
 * e.g. "ls /api.example.com/data" => "api.example.com"
 *      "cat /github.com/repos"   => "github.com"
 */
function extractDomainFromCommand(command: string): string | null {
  const parts = command.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const path = parts[1];
  if (!path.startsWith("/")) return null;
  const segments = path.slice(1).split("/");
  return segments[0] || null;
}

export function federationRoutes(options: FederationRouteOptions) {
  const { peerStore, vault, agentFs } = options;
  const app = new Hono<Env>();

  // POST /federation/query — Check if we have credentials for a domain
  app.post("/query", async (c) => {
    const peerId = c.req.header("X-Peer-Id");
    const authHeader = c.req.header("Authorization");

    const peer = await authenticatePeer(peerStore, peerId, authHeader);
    if (!peer) {
      return c.json({ error: "Unauthorized peer" }, 403);
    }

    const body = await c.req.json<{ domain: string }>();
    if (!body.domain) {
      return c.json({ error: "Missing 'domain' field" }, 400);
    }

    // Update last seen
    await peerStore.updateLastSeen(peer.id, Date.now());

    // Check if we have a credential for this domain
    const credential = await vault.get(body.domain);
    if (!credential) {
      return c.json({ available: false });
    }

    // Check lending rule
    const rule = await peerStore.getRule(body.domain);
    if (!rule || !rule.allow) {
      return c.json({ available: false });
    }

    // Check if this peer is in the allowed list
    if (rule.peers !== "*" && !rule.peers.includes(peer.id)) {
      return c.json({ available: false });
    }

    return c.json({
      available: true,
      pricing: rule.pricing,
    });
  });

  // POST /federation/exec — Execute a command on behalf of a peer
  app.post("/exec", async (c) => {
    const peerId = c.req.header("X-Peer-Id");
    const authHeader = c.req.header("Authorization");

    const peer = await authenticatePeer(peerStore, peerId, authHeader);
    if (!peer) {
      return c.json({ error: "Unauthorized peer" }, 403);
    }

    const body = await c.req.json<{ command: string; agentId: string }>();
    if (!body.command) {
      return c.json({ error: "Missing 'command' field" }, 400);
    }

    // Update last seen
    await peerStore.updateLastSeen(peer.id, Date.now());

    // Extract domain from command and check lending rule
    const domain = extractDomainFromCommand(body.command);
    if (domain) {
      const rule = await peerStore.getRule(domain);

      if (!rule || !rule.allow) {
        return c.json({ error: "Domain not available for lending" }, 403);
      }

      if (rule.peers !== "*" && !rule.peers.includes(peer.id)) {
        return c.json({ error: "Peer not in allowed list" }, 403);
      }

      // Check if payment is required
      if (rule.pricing.mode !== "free") {
        const paymentHeader = c.req.header("X-402-Payment");
        if (!paymentHeader) {
          return c.json({ error: "Payment required" }, 402);
        }
      }
    }

    // Execute with synthetic agent context: peer:{peerId}:{agentId}
    const syntheticAgentId = `peer:${peer.id}:${body.agentId}`;
    const result = await agentFs.execute(body.command, ["agent"], {
      id: syntheticAgentId,
      roles: ["agent"],
    });

    if (!result.ok) {
      return c.json({ ok: false, error: result.error.message }, 500);
    }

    return c.json({ ok: true, data: result.data });
  });

  // POST /federation/announce — Peer announces available domains
  app.post("/announce", async (c) => {
    const peerId = c.req.header("X-Peer-Id");
    const authHeader = c.req.header("Authorization");

    const peer = await authenticatePeer(peerStore, peerId, authHeader);
    if (!peer) {
      return c.json({ error: "Unauthorized peer" }, 403);
    }

    const body = await c.req.json<{ domains: string[] }>();
    if (!Array.isArray(body.domains)) {
      return c.json({ error: "Missing 'domains' field" }, 400);
    }

    // Update peer's advertised domains and last seen
    peer.advertisedDomains = body.domains;
    await peerStore.putPeer(peer);
    await peerStore.updateLastSeen(peer.id, Date.now());

    return c.json({ ok: true });
  });

  return app;
}
