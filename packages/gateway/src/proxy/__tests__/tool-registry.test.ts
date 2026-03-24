import { describe, it, expect } from "vitest";
import type { HttpAuth } from "@nkmc/agent-fs";
import {
  ToolRegistry,
  createDefaultToolRegistry,
} from "../tool-registry.js";

describe("ToolRegistry", () => {
  it("resolves a known tool", () => {
    const registry = createDefaultToolRegistry();
    const gh = registry.get("gh");

    expect(gh).not.toBeNull();
    expect(gh!.name).toBe("gh");
    expect(gh!.credentialDomain).toBe("github.com");
  });

  it("returns null for an unknown tool", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.get("nonexistent")).toBeNull();
  });

  it("lists all registered tools", () => {
    const registry = createDefaultToolRegistry();
    const tools = registry.list();

    expect(tools.length).toBe(5);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["anthropic", "aws", "gh", "openai", "stripe"]);
  });

  it("builds env vars from bearer credential (gh → GH_TOKEN)", () => {
    const registry = createDefaultToolRegistry();
    const gh = registry.get("gh")!;

    const auth: HttpAuth = { type: "bearer", token: "ghp_abc123" };
    const env = registry.buildEnv(gh, auth);

    expect(env).toEqual({ GH_TOKEN: "ghp_abc123" });
  });

  it("builds env vars for api-key auth type (stripe → STRIPE_API_KEY)", () => {
    const registry = createDefaultToolRegistry();
    const stripe = registry.get("stripe")!;

    const auth: HttpAuth = {
      type: "api-key",
      header: "Authorization",
      key: "sk_test_xyz",
    };
    const env = registry.buildEnv(stripe, auth);

    expect(env).toEqual({ STRIPE_API_KEY: "sk_test_xyz" });
  });

  it("builds env vars for basic auth (aws → ACCESS_KEY_ID + SECRET)", () => {
    const registry = createDefaultToolRegistry();
    const aws = registry.get("aws")!;

    const auth: HttpAuth = {
      type: "basic",
      username: "AKIAIOSFODNN7EXAMPLE",
      password: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    };
    const env = registry.buildEnv(aws, auth);

    expect(env).toEqual({
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
  });

  it("omits env vars when auth type does not match requested field", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test",
      credentialDomain: "example.com",
      envMapping: { MY_TOKEN: "token" },
    });
    const tool = registry.get("test")!;

    // Pass basic auth but tool wants "token" → should get empty env
    const auth: HttpAuth = {
      type: "basic",
      username: "user",
      password: "pass",
    };
    const env = registry.buildEnv(tool, auth);

    expect(env).toEqual({});
  });
});
