import { Hono } from "hono";
import type { Env } from "../app.js";
import type { PeerStore, PeerGateway, LendingRule } from "../../federation/types.js";

export interface PeerRouteOptions {
  peerStore: PeerStore;
}

export function peerRoutes(options: PeerRouteOptions) {
  const { peerStore } = options;
  const app = new Hono<Env>();

  // GET /peers — list all peers (don't expose sharedSecret)
  app.get("/peers", async (c) => {
    const peers = await peerStore.listPeers();
    const safe = peers.map(({ sharedSecret: _, ...rest }) => rest);
    return c.json({ peers: safe });
  });

  // PUT /peers/:id — create or update peer
  app.put("/peers/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      url?: string;
      sharedSecret?: string;
    }>();

    if (!body.name || !body.url || !body.sharedSecret) {
      return c.json({ error: "Missing required fields: name, url, sharedSecret" }, 400);
    }

    const existing = await peerStore.getPeer(id);
    const now = Date.now();

    const peer: PeerGateway = {
      id,
      name: body.name,
      url: body.url,
      sharedSecret: body.sharedSecret,
      status: "active",
      advertisedDomains: existing?.advertisedDomains ?? [],
      lastSeen: existing?.lastSeen ?? 0,
      createdAt: existing?.createdAt ?? now,
    };

    await peerStore.putPeer(peer);
    return c.json({ ok: true, id });
  });

  // DELETE /peers/:id — remove peer
  app.delete("/peers/:id", async (c) => {
    const id = c.req.param("id");
    await peerStore.deletePeer(id);
    return c.json({ ok: true, id });
  });

  // GET /rules — list all lending rules
  app.get("/rules", async (c) => {
    const rules = await peerStore.listRules();
    return c.json({ rules });
  });

  // PUT /rules/:domain — create or update lending rule
  app.put("/rules/:domain", async (c) => {
    const domain = c.req.param("domain");
    const body = await c.req.json<{
      allow?: boolean;
      peers?: string[] | "*";
      pricing?: { mode: string; amount?: number };
      rateLimit?: { requests: number; window: string };
    }>();

    if (body.allow === undefined) {
      return c.json({ error: "Missing required field: allow" }, 400);
    }

    const existing = await peerStore.getRule(domain);
    const now = Date.now();

    const rule: LendingRule = {
      domain,
      allow: body.allow,
      peers: body.peers ?? existing?.peers ?? "*",
      pricing: (body.pricing as LendingRule["pricing"]) ?? existing?.pricing ?? { mode: "free" },
      rateLimit: body.rateLimit as LendingRule["rateLimit"],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await peerStore.putRule(rule);
    return c.json({ ok: true, domain });
  });

  // DELETE /rules/:domain — remove lending rule
  app.delete("/rules/:domain", async (c) => {
    const domain = c.req.param("domain");
    await peerStore.deleteRule(domain);
    return c.json({ ok: true, domain });
  });

  return app;
}
