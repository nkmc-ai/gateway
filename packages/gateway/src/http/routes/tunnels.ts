import { Hono } from "hono";
import type { Env } from "../app.js";
import type { TunnelStore, TunnelProvider } from "../../tunnel/types.js";
import { nanoid } from "nanoid";

export interface TunnelRouteOptions {
  tunnelStore: TunnelStore;
  tunnelProvider: TunnelProvider;
  tunnelDomain: string; // e.g. "tunnel.example.com"
}

export function tunnelRoutes(options: TunnelRouteOptions) {
  const { tunnelStore, tunnelProvider, tunnelDomain } = options;
  const app = new Hono<Env>();

  // POST /tunnels/create — create a tunnel for the authenticated agent
  app.post("/create", async (c) => {
    const agent = c.get("agent");
    const body = await c.req.json<{
      advertisedDomains?: string[];
      gatewayName?: string;
    }>().catch(() => ({} as { advertisedDomains?: string[]; gatewayName?: string }));

    // Check if agent already has a tunnel
    const existing = await tunnelStore.getByAgent(agent.id);
    if (existing && existing.status === "active") {
      return c.json({
        tunnelId: existing.id,
        publicUrl: existing.publicUrl,
        message: "Tunnel already exists",
      });
    }

    const id = nanoid(12);
    const hostname = `${id}.${tunnelDomain}`;
    const publicUrl = `https://${hostname}`;

    // Create via Cloudflare API
    const { tunnelId, tunnelToken } = await tunnelProvider.create(
      `nkmc-${agent.id}-${id}`,
      hostname,
    );

    const now = Date.now();

    // Store record
    await tunnelStore.put({
      id,
      agentId: agent.id,
      tunnelId,
      publicUrl,
      status: "active",
      createdAt: now,
      advertisedDomains: body.advertisedDomains ?? [],
      gatewayName: body.gatewayName,
      lastSeen: now,
    });

    return c.json({ tunnelId: id, tunnelToken, publicUrl }, 201);
  });

  // DELETE /tunnels/:id — delete a tunnel
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const agent = c.get("agent");

    const record = await tunnelStore.get(id);
    if (!record) return c.json({ error: "Tunnel not found" }, 404);
    if (record.agentId !== agent.id)
      return c.json({ error: "Not your tunnel" }, 403);

    await tunnelProvider.delete(record.tunnelId);
    await tunnelStore.delete(id);

    return c.json({ ok: true });
  });

  // GET /tunnels — list agent's tunnels
  app.get("/", async (c) => {
    const agent = c.get("agent");
    const all = await tunnelStore.list();
    const mine = all.filter((t) => t.agentId === agent.id);
    return c.json({ tunnels: mine });
  });

  // GET /tunnels/discover — list all online gateways (public info only)
  // Optional: ?domain=api.openai.com — filter by advertised domain
  app.get("/discover", async (c) => {
    const domain = c.req.query("domain");
    const all = await tunnelStore.list();

    let results = all.filter((t) => t.status === "active");
    if (domain) {
      results = results.filter((t) => t.advertisedDomains.includes(domain));
    }

    // Return public info only — no tunnelToken, no internal IDs
    return c.json({
      gateways: results.map((t) => ({
        id: t.id,
        name: t.gatewayName ?? `gateway-${t.id}`,
        publicUrl: t.publicUrl,
        advertisedDomains: t.advertisedDomains,
      })),
    });
  });

  // POST /tunnels/heartbeat — update advertised domains and confirm online
  app.post("/heartbeat", async (c) => {
    const agent = c.get("agent");
    const body = await c.req.json<{ advertisedDomains?: string[] }>();

    const record = await tunnelStore.getByAgent(agent.id);
    if (!record) return c.json({ error: "No active tunnel" }, 404);

    record.advertisedDomains = body.advertisedDomains ?? record.advertisedDomains;
    record.lastSeen = Date.now();
    await tunnelStore.put(record);

    return c.json({ ok: true });
  });

  return app;
}
