import { Hono } from "hono";
import { signJwt } from "@nkmc/core";
import type { JWK } from "jose";
import type { Env } from "../app.js";

export interface AuthRouteOptions {
  privateKey: JWK;
}

export function authRoutes(options: AuthRouteOptions) {
  const app = new Hono<Env>();

  app.post("/token", async (c) => {
    const body = await c.req.json<{
      sub: string;
      roles?: string[];
      svc: string;
      expiresIn?: string;
    }>();

    if (!body.sub || !body.svc) {
      return c.json({ error: "Missing required fields: sub, svc" }, 400);
    }

    const token = await signJwt(
      options.privateKey,
      {
        sub: body.sub,
        roles: body.roles ?? ["agent"],
        svc: body.svc,
      },
      body.expiresIn ? { expiresIn: body.expiresIn } : undefined,
    );

    return c.json({ token });
  });

  return app;
}
