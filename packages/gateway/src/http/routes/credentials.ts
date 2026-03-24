import { Hono } from "hono";
import type { CredentialVault } from "../../credential/types.js";
import type { Env } from "../app.js";

export interface CredentialRouteOptions {
  vault: CredentialVault;
}

export function credentialRoutes(options: CredentialRouteOptions) {
  const { vault } = options;
  const app = new Hono<Env>();

  // PUT /credentials/:domain — set pool credential
  app.put("/:domain", async (c) => {
    const domain = c.req.param("domain");
    const body = await c.req.json<{ auth: { type: string; token?: string; header?: string; key?: string; username?: string; password?: string } }>();

    if (!body.auth?.type) {
      return c.json({ error: "Missing auth.type" }, 400);
    }

    await vault.putPool(domain, body.auth as any);
    return c.json({ ok: true, domain });
  });

  // GET /credentials — list domains with credentials
  app.get("/", async (c) => {
    const domains = await vault.listDomains();
    return c.json({ domains });
  });

  // DELETE /credentials/:domain — delete pool credential
  app.delete("/:domain", async (c) => {
    const domain = c.req.param("domain");
    await vault.delete(domain);
    return c.json({ ok: true, domain });
  });

  return app;
}
