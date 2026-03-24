import type { HttpAuth } from "@nkmc/agent-fs";

/** Field names that can be extracted from an HttpAuth credential. */
export type AuthField = "token" | "key" | "username" | "password";

/**
 * Defines how a CLI tool maps to a credential domain and which
 * environment variables should be injected at runtime.
 */
export interface ToolDefinition {
  /** CLI tool name, e.g. "gh", "stripe" */
  name: string;
  /** Domain used to look up credentials in the vault */
  credentialDomain: string;
  /** Maps env var name → field to extract from HttpAuth */
  envMapping: Record<string, AuthField>;
}

/**
 * Registry of CLI tools that can be proxied through the gateway.
 * Each tool declares the credential domain it needs and how to
 * translate stored credentials into environment variables.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** Register a tool definition. Overwrites any existing entry with the same name. */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** Look up a tool by name. Returns null if not found. */
  get(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  /** Return all registered tool definitions. */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * Build a record of environment variables for the given tool by
   * extracting the requested fields from the HttpAuth credential.
   *
   * If the auth type does not contain the requested field (e.g.
   * requesting "token" from a basic-auth credential), that env var
   * is silently omitted.
   */
  buildEnv(tool: ToolDefinition, auth: HttpAuth): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [envVar, field] of Object.entries(tool.envMapping)) {
      const value = extractField(auth, field);
      if (value !== undefined) {
        env[envVar] = value;
      }
    }

    return env;
  }
}

/** Extract a named field from an HttpAuth credential. */
function extractField(auth: HttpAuth, field: AuthField): string | undefined {
  switch (field) {
    case "token":
      return auth.type === "bearer" ? auth.token : undefined;
    case "key":
      return auth.type === "api-key" ? auth.key : undefined;
    case "username":
      return auth.type === "basic" ? auth.username : undefined;
    case "password":
      return auth.type === "basic" ? auth.password : undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Default tools
// ---------------------------------------------------------------------------

/** Create a ToolRegistry pre-populated with common CLI tools. */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "gh",
    credentialDomain: "github.com",
    envMapping: { GH_TOKEN: "token" },
  });

  registry.register({
    name: "stripe",
    credentialDomain: "api.stripe.com",
    envMapping: { STRIPE_API_KEY: "key" },
  });

  registry.register({
    name: "openai",
    credentialDomain: "api.openai.com",
    envMapping: { OPENAI_API_KEY: "key" },
  });

  registry.register({
    name: "anthropic",
    credentialDomain: "api.anthropic.com",
    envMapping: { ANTHROPIC_API_KEY: "key" },
  });

  registry.register({
    name: "aws",
    credentialDomain: "aws.amazon.com",
    envMapping: {
      AWS_ACCESS_KEY_ID: "username",
      AWS_SECRET_ACCESS_KEY: "password",
    },
  });

  return registry;
}
