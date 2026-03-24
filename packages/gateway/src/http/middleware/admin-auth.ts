import { createMiddleware } from "hono/factory";
import type { Env } from "../app.js";

export function adminAuth(adminToken: string) {
  return createMiddleware<Env>(async (c, next) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = auth.slice(7);
    if (token !== adminToken) {
      return c.json({ error: "Invalid admin token" }, 403);
    }

    await next();
  });
}
