import { createMiddleware } from "hono/factory";
import { verifyJwt } from "@nkmc/core";
import type { JWK } from "jose";
import type { Env } from "../app.js";

export function agentAuth(publicKey: JWK) {
  return createMiddleware<Env>(async (c, next) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = auth.slice(7);
    try {
      const payload = await verifyJwt(token, publicKey);
      c.set("agent", { id: payload.sub, roles: payload.roles });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid token";
      if (message.includes("exp") || message.includes("expired")) {
        return c.json({ error: "Token has expired" }, 401);
      }
      return c.json({ error: "Invalid token" }, 401);
    }

    await next();
  });
}
