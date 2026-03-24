import type { ManifestEntry, RpcManifestDef } from "./types.js";

/**
 * Curated manifest of major public APIs with verified OpenAPI spec URLs.
 *
 * Categories:
 * - free: No auth needed, all endpoints public
 * - freemium: Some endpoints public, auth optional
 * - auth-required: Auth needed for all API calls
 *
 * All spec URLs verified reachable as of 2026-02.
 */

// ── Free / No-Auth APIs ──────────────────────────────────────────────

export const FREE_APIS: ManifestEntry[] = [
  {
    domain: "petstore3.swagger.io",
    specUrl: "https://petstore3.swagger.io/api/v3/openapi.json",
    tags: ["demo", "free"],
  },
  {
    domain: "api.weather.gov",
    specUrl: "https://api.weather.gov/openapi.json",
    tags: ["weather", "government", "free"],
  },
  {
    domain: "en.wikipedia.org",
    specUrl: "https://en.wikipedia.org/api/rest_v1/?spec",
    tags: ["knowledge", "encyclopedia", "free"],
  },
];

// ── Freemium APIs (public read, auth optional) ──────────────────────

export const FREEMIUM_APIS: ManifestEntry[] = [
  {
    domain: "api.github.com",
    specUrl:
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.2022-11-28.json",
    auth: { type: "bearer", token: "${GITHUB_TOKEN}" },
    tags: ["developer-tools", "vcs", "freemium"],
  },
  {
    domain: "huggingface.co",
    specUrl: "https://huggingface.co/.well-known/openapi.json",
    auth: { type: "bearer", token: "${HF_TOKEN}" },
    tags: ["ai", "ml", "models", "freemium"],
  },
];

// ── Auth-Required APIs (Developer Tools) ─────────────────────────────

export const DEVELOPER_TOOL_APIS: ManifestEntry[] = [
  {
    domain: "gitlab.com",
    specUrl:
      "https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi.yaml",
    auth: { type: "bearer", token: "${GITLAB_TOKEN}" },
    tags: ["developer-tools", "vcs"],
  },
  {
    domain: "api.vercel.com",
    specUrl: "https://openapi.vercel.sh",
    auth: { type: "bearer", token: "${VERCEL_TOKEN}" },
    tags: ["developer-tools", "hosting"],
  },
  {
    domain: "sentry.io",
    specUrl:
      "https://raw.githubusercontent.com/getsentry/sentry-api-schema/main/openapi-derefed.json",
    auth: { type: "bearer", token: "${SENTRY_AUTH_TOKEN}" },
    tags: ["developer-tools", "monitoring"],
  },
  {
    domain: "api.pagerduty.com",
    specUrl:
      "https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json",
    auth: { type: "bearer", token: "${PAGERDUTY_TOKEN}" },
    tags: ["developer-tools", "incident-management"],
  },
];

// ── AI / ML APIs ─────────────────────────────────────────────────────

export const AI_APIS: ManifestEntry[] = [
  {
    domain: "api.mistral.ai",
    specUrl:
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml",
    auth: { type: "bearer", token: "${MISTRAL_API_KEY}" },
    tags: ["ai", "llm"],
    disabled: true, // upstream YAML spec has unescaped quotes in example data
  },
  {
    domain: "api.openai.com",
    specUrl:
      "https://raw.githubusercontent.com/openai/openai-openapi/manual_spec/openapi.yaml",
    auth: { type: "bearer", token: "${OPENAI_API_KEY}" },
    tags: ["ai", "llm"],
  },
  {
    domain: "openrouter.ai",
    specUrl: "https://openrouter.ai/openapi.json",
    auth: { type: "bearer", token: "${OPENROUTER_API_KEY}" },
    tags: ["ai", "llm", "gateway"],
  },
];

// ── Cloud / Infrastructure APIs ──────────────────────────────────────

export const CLOUD_APIS: ManifestEntry[] = [
  {
    domain: "api.cloudflare.com",
    specUrl:
      "https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.yaml",
    auth: { type: "bearer", token: "${CLOUDFLARE_API_TOKEN}" },
    tags: ["cloud", "cdn", "dns"],
  },
  {
    domain: "api.digitalocean.com",
    specUrl:
      "https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml",
    auth: { type: "bearer", token: "${DIGITALOCEAN_TOKEN}" },
    tags: ["cloud", "infrastructure"],
  },
  {
    domain: "fly.io",
    specUrl: "https://docs.machines.dev/spec/openapi3.json",
    auth: { type: "bearer", token: "${FLY_API_TOKEN}" },
    tags: ["cloud", "deployment"],
  },
  {
    domain: "api.render.com",
    specUrl:
      "https://api-docs.render.com/v1.0/openapi/render-public-api-1.json",
    auth: { type: "bearer", token: "${RENDER_API_KEY}" },
    tags: ["cloud", "deployment"],
  },
];

// ── Productivity / Project Management ────────────────────────────────

export const PRODUCTIVITY_APIS: ManifestEntry[] = [
  {
    domain: "api.notion.com",
    specUrl:
      "https://raw.githubusercontent.com/makenotion/notion-mcp-server/main/scripts/notion-openapi.json",
    auth: { type: "bearer", token: "${NOTION_API_KEY}" },
    tags: ["productivity", "database"],
  },
  {
    domain: "app.asana.com",
    specUrl:
      "https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml",
    auth: { type: "bearer", token: "${ASANA_ACCESS_TOKEN}" },
    tags: ["productivity", "project-management"],
  },
  {
    domain: "jira.atlassian.com",
    specUrl:
      "https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json",
    auth: { type: "bearer", token: "${ATLASSIAN_API_TOKEN}" },
    tags: ["productivity", "project-management"],
  },
  {
    domain: "api.spotify.com",
    specUrl:
      "https://raw.githubusercontent.com/sonallux/spotify-web-api/main/fixed-spotify-open-api.yml",
    auth: { type: "bearer", token: "${SPOTIFY_ACCESS_TOKEN}" },
    tags: ["media", "music"],
  },
  {
    domain: "api.getpostman.com",
    specUrl:
      "https://api.apis.guru/v2/specs/getpostman.com/1.20.0/openapi.json",
    auth: { type: "api-key", header: "X-Api-Key", key: "${POSTMAN_API_KEY}" },
    tags: ["developer-tools", "api-testing"],
  },
];

// ── DevOps / CI/CD ──────────────────────────────────────────────────

export const DEVOPS_APIS: ManifestEntry[] = [
  {
    domain: "circleci.com",
    specUrl: "https://circleci.com/api/v2/openapi.json",
    auth: { type: "bearer", token: "${CIRCLECI_TOKEN}" },
    tags: ["devops", "ci-cd"],
  },
  {
    domain: "api.datadoghq.com",
    specUrl:
      "https://raw.githubusercontent.com/DataDog/datadog-api-client-python/master/.generator/schemas/v2/openapi.yaml",
    auth: { type: "api-key", header: "DD-API-KEY", key: "${DATADOG_API_KEY}" },
    tags: ["devops", "monitoring"],
  },
];

// ── Database / BaaS ─────────────────────────────────────────────────

export const DATABASE_APIS: ManifestEntry[] = [
  {
    domain: "api.supabase.com",
    specUrl:
      "https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json",
    auth: { type: "bearer", token: "${SUPABASE_ACCESS_TOKEN}" },
    tags: ["database", "baas"],
  },
  {
    domain: "api.turso.tech",
    specUrl:
      "https://raw.githubusercontent.com/tursodatabase/turso-docs/main/api-reference/openapi.json",
    auth: { type: "bearer", token: "${TURSO_API_TOKEN}" },
    tags: ["database", "edge"],
  },
  {
    domain: "console.neon.tech",
    specUrl:
      "https://raw.githubusercontent.com/neondatabase/neon-api-python/main/v2.json",
    auth: { type: "bearer", token: "${NEON_API_KEY}" },
    tags: ["database", "serverless-postgres"],
  },
];

// ── Commerce / Payments ──────────────────────────────────────────────

export const COMMERCE_APIS: ManifestEntry[] = [
  {
    domain: "api.stripe.com",
    specUrl:
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    auth: { type: "bearer", token: "${STRIPE_SECRET_KEY}" },
    tags: ["commerce", "payments"],
  },
];

// ── Communication APIs ───────────────────────────────────────────────

export const COMMUNICATION_APIS: ManifestEntry[] = [
  {
    domain: "slack.com",
    specUrl:
      "https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json",
    auth: { type: "bearer", token: "${SLACK_BOT_TOKEN}" },
    tags: ["communication", "messaging"],
  },
  {
    domain: "discord.com",
    specUrl:
      "https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json",
    auth: { type: "bearer", token: "${DISCORD_BOT_TOKEN}", prefix: "Bot" },
    tags: ["communication", "messaging"],
  },
  {
    domain: "api.twilio.com",
    specUrl:
      "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
    auth: { type: "basic", token: "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" },
    tags: ["communication", "sms", "voice"],
  },
  {
    domain: "api.resend.com",
    specUrl:
      "https://raw.githubusercontent.com/resendlabs/resend-openapi/main/resend.yaml",
    auth: { type: "bearer", token: "${RESEND_API_KEY}" },
    tags: ["communication", "email"],
  },
];

// ── JSON-RPC APIs ───────────────────────────────────────────────────

/** Standard EVM methods shared across all Ethereum-compatible RPC providers */
const EVM_METHODS: RpcManifestDef["methods"] = [
  { rpcMethod: "eth_blockNumber", description: "Returns the latest block number", resource: "blocks", fsOp: "list" },
  { rpcMethod: "eth_getBlockByNumber", description: "Returns block by number", resource: "blocks", fsOp: "read" },
  { rpcMethod: "eth_getBalance", description: "Returns account balance in wei", resource: "balances", fsOp: "read" },
  { rpcMethod: "eth_getTransactionByHash", description: "Returns transaction by hash", resource: "transactions", fsOp: "read" },
  { rpcMethod: "eth_getTransactionReceipt", description: "Returns transaction receipt", resource: "receipts", fsOp: "read" },
  { rpcMethod: "eth_call", description: "Executes a call without creating a transaction", resource: "calls", fsOp: "read" },
  { rpcMethod: "eth_estimateGas", description: "Estimates gas needed for a transaction", resource: "gas", fsOp: "read" },
  { rpcMethod: "eth_gasPrice", description: "Returns current gas price in wei" },
  { rpcMethod: "eth_chainId", description: "Returns the chain ID" },
  { rpcMethod: "eth_getCode", description: "Returns contract bytecode at address", resource: "code", fsOp: "read" },
  { rpcMethod: "eth_getLogs", description: "Returns logs matching a filter", resource: "logs", fsOp: "list" },
  { rpcMethod: "eth_getTransactionCount", description: "Returns the number of transactions sent from an address", resource: "nonces", fsOp: "read" },
  { rpcMethod: "net_version", description: "Returns the network ID" },
];

export const RPC_APIS: ManifestEntry[] = [
  // ── Free / Public RPC Providers ──────────────────────────────────
  {
    domain: "rpc.ankr.com",
    rpcDef: { url: "https://rpc.ankr.com/eth", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "ethereum", "free"],
  },
  {
    domain: "cloudflare-eth.com",
    rpcDef: { url: "https://cloudflare-eth.com", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "ethereum", "free"],
  },
  {
    domain: "ethereum-rpc.publicnode.com",
    rpcDef: { url: "https://ethereum-rpc.publicnode.com", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "ethereum", "free"],
  },

  // ── Auth-Required RPC Providers ──────────────────────────────────
  {
    domain: "eth-mainnet.g.alchemy.com",
    rpcDef: { url: "https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "ethereum"],
  },
  {
    domain: "mainnet.infura.io",
    rpcDef: { url: "https://mainnet.infura.io/v3/${INFURA_API_KEY}", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "ethereum"],
  },

  // ── L2 / Alt Chains (Free) ───────────────────────────────────────
  {
    domain: "arb1.arbitrum.io",
    rpcDef: { url: "https://arb1.arbitrum.io/rpc", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "arbitrum", "l2", "free"],
  },
  {
    domain: "mainnet.optimism.io",
    rpcDef: { url: "https://mainnet.optimism.io", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "optimism", "l2", "free"],
  },
  {
    domain: "mainnet.base.org",
    rpcDef: { url: "https://mainnet.base.org", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "base", "l2", "free"],
  },
  {
    domain: "polygon-rpc.com",
    rpcDef: { url: "https://polygon-rpc.com", convention: "evm", methods: EVM_METHODS },
    tags: ["blockchain", "polygon", "free"],
  },
];

// ── All APIs combined ────────────────────────────────────────────────

export const ALL_APIS: ManifestEntry[] = [
  ...FREE_APIS,
  ...FREEMIUM_APIS,
  ...DEVELOPER_TOOL_APIS,
  ...AI_APIS,
  ...CLOUD_APIS,
  ...PRODUCTIVITY_APIS,
  ...DEVOPS_APIS,
  ...DATABASE_APIS,
  ...COMMERCE_APIS,
  ...COMMUNICATION_APIS,
  ...RPC_APIS,
];

/** Get APIs that can be onboarded without any credentials (spec is public) */
export function getSpecOnlyApis(): ManifestEntry[] {
  return ALL_APIS.map((e) => ({ ...e, auth: undefined }));
}
