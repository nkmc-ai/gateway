import { Hono } from "hono";
import type { CredentialVault } from "../../credential/types.js";
import type { Env } from "../app.js";

export interface ByokRouteOptions {
  vault: CredentialVault;
}

export function byokRoutes(options: ByokRouteOptions) {
  const { vault } = options;
  const app = new Hono<Env>();

  // PUT /credentials/byok/:domain — upload BYOK credential (agent JWT required)
  app.put("/:domain", async (c) => {
    const domain = c.req.param("domain");
    const agent = c.get("agent");
    const body = await c.req.json<{
      auth: {
        type: string;
        token?: string;
        header?: string;
        key?: string;
        username?: string;
        password?: string;
      };
    }>();

    if (!body.auth?.type) {
      return c.json({ error: "Missing auth.type" }, 400);
    }

    await vault.putByok(domain, agent.id, body.auth as any);
    return c.json({ ok: true, domain });
  });

  // GET /credentials/byok — list agent's BYOK domains
  app.get("/", async (c) => {
    const agent = c.get("agent");
    const allDomains = await vault.listDomains();

    // Filter to only domains where this agent has BYOK credentials
    const byokDomains: string[] = [];
    for (const domain of allDomains) {
      const cred = await vault.get(domain, agent.id);
      if (cred && cred.scope === "byok" && cred.developerId === agent.id) {
        byokDomains.push(domain);
      }
    }

    return c.json({ domains: byokDomains });
  });

  // DELETE /credentials/byok/:domain — delete agent's BYOK credential
  app.delete("/:domain", async (c) => {
    const domain = c.req.param("domain");
    const agent = c.get("agent");
    await vault.delete(domain, agent.id);
    return c.json({ ok: true, domain });
  });

  return app;
}
