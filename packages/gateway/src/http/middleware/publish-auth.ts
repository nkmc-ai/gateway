import { createMiddleware } from "hono/factory";
import type { JWK } from "jose";
import { verifyPublishToken } from "@nkmc/core";

export type PublishAuthContext =
  | { type: "admin" }
  | { type: "publish"; domain: string };

type PublishAuthEnv = {
  Variables: {
    publishAuth: PublishAuthContext;
  };
};

export function publishOrAdminAuth(adminToken: string, publicKey: JWK) {
  return createMiddleware<PublishAuthEnv>(async (c, next) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = auth.slice(7);

    // 1. Try admin token (string comparison)
    if (token === adminToken) {
      c.set("publishAuth", { type: "admin" });
      return next();
    }

    // 2. Try publish token (JWT signed by gateway)
    try {
      const payload = await verifyPublishToken(token, publicKey);
      c.set("publishAuth", { type: "publish", domain: payload.sub });
      return next();
    } catch {
      return c.json({ error: "Invalid token" }, 403);
    }
  });
}
