# nkmc gateway

**[日本語](README.ja.md)** | **[简体中文](README.zh.md)**

A federated API gateway for AI agents. Store credentials in an encrypted vault, proxy CLI tools without exposing keys, and federate with peer gateways to share access.

```
                         Hosted Gateway (coordination)
                         ┌─────────────────────────┐
                         │  Tunnel Registry         │
                         │  Peer Discovery          │
                         │  Pool Credentials (40+)  │
                         └────────┬────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │ CF Tunnel   │  CF Tunnel   │
                    ▼             │              ▼
        ┌──────────────┐         │    ┌──────────────┐
        │ Your Gateway │ ◄───────┘    │ Peer Gateway │
        │ (localhost)  │ ◄──────────► │ (anywhere)   │
        │              │  federation  │              │
        │ Vault:       │  query/exec  │ Vault:       │
        │  github.com  │              │  openai.com  │
        │  stripe.com  │              │  anthropic   │
        └──────┬───────┘              └──────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
 nkmc run   nkmc cat   nkmc ls
 gh repo    /openai/   /
 list       models
```

### How it works

**1. Local operations** — Your gateway stores credentials encrypted, injects them at request time:

```
nkmc run gh repo list
  |
  +-- POST /proxy/exec ----->  ToolRegistry: gh -> github.com
  |                            Vault: decrypt AES-GCM -> ghp_xxx
  |                            Exec: spawn("gh", [...], { GH_TOKEN })
  |                            <---- { stdout, exitCode }
```

**2. Federation** — When local credentials are missing, query peers:

```
nkmc cat /api.openai.com/models
  |
  +-- POST /execute -------->  Vault: no local key for api.openai.com
  |                            +-- Peer fallback ---------->  Peer Gateway
  |                            |   query: api.openai.com?     check lending rule
  |                            |   <-- available: true        Vault: inject key
  |                            |   exec: cat /models          fetch OpenAI API
  |                            |   <-- { data: [...] }        <-- response
  |                            <---- result
```

**3. Tunnel & Discovery** — The hosted gateway coordinates the network:

```
nkmc gateway start --tunnel
  |
  +-- Start local gateway on :9090
  +-- POST hosted/tunnels/create -------->  Hosted Gateway
  |     { advertisedDomains: [...] }        Create CF Tunnel
  |     <-- { tunnelToken, publicUrl }      Register in discovery
  +-- Start cloudflared connector
  |     localhost:9090 <===> Cloudflare Edge <===> publicUrl
  |
  Done: https://abc123.tunnel.nkmc.ai

# Other gateways can now discover and peer with you:
nkmc peers discover               # queries hosted gateway
nkmc peers discover --domain gh   # find who has GitHub credentials
```

## Quick Start

### Solo mode (local only)

```bash
# Install
npm install -g @nkmc/cli @nkmc/server

# Start gateway
nkmc gateway start

# Authenticate
nkmc auth --gateway-url http://localhost:9090

# Store a key (AES-GCM encrypted in local vault)
nkmc keys set github.com --token ghp_...

# Use it
nkmc run gh repo list
nkmc cat /api.github.com/repos/nkmc-ai/gateway
```

### Network mode (federation + tunnel)

```bash
# Authenticate with hosted gateway (for tunnel + discovery)
nkmc auth

# Start with tunnel — your gateway becomes publicly reachable
nkmc gateway start --tunnel
# => Local:  http://localhost:9090
# => Public: https://abc123.tunnel.nkmc.ai

# Set lending rules — decide what to share
nkmc rules set github.com --allow --pricing free
nkmc rules set api.stripe.com --deny

# Discover peers on the network
nkmc peers discover
# => Bob's Gateway — https://xyz789.tunnel.nkmc.ai
# =>   Domains: api.openai.com, api.anthropic.com

# Add a peer
nkmc peers add --id bob --name "Bob" \
  --url https://xyz789.tunnel.nkmc.ai --secret shared-key

# Now you can use Bob's OpenAI credentials
nkmc cat /api.openai.com/models
# => routed to Bob's gateway, Bob's key injected, result returned
```

## Features

- **Credential Vault** -- API keys encrypted with AES-GCM in SQLite. Agents authenticate with JWT; the gateway injects credentials on their behalf. Keys never leave the gateway.
- **CLI Proxy** -- Run existing CLI tools (`gh`, `stripe`, `openai`, `aws`) through the gateway. It looks up the tool's credential domain, injects env vars, executes, and returns output.
- **Service Registry** -- Register any HTTP API via OpenAPI auto-discovery (`nkmc register --url http://localhost:3000`) or a `skill.md` manifest. Browse registered services with `nkmc ls /`.
- **Gateway Federation** -- Peer gateways can lend credentials to each other. When local credentials are missing, the gateway queries peers. Lending rules control access (free, per-request, per-token pricing via x402).
- **Tunnel & Discovery** -- `nkmc gateway start --tunnel` creates a Cloudflare Tunnel for NAT traversal. Gateways register with a coordination server and discover each other automatically.
- **BYOK (Bring Your Own Key)** -- Agents can upload their own API keys to the gateway vault. BYOK keys take priority over pool keys.
- **Domain Verification** -- Claim ownership of a domain via DNS TXT challenge (`nkmc claim example.com`). Verified domains get a publish token for registering services.
- **Virtual Filesystem** -- APIs are mounted as virtual paths (`/api.openai.com/models`). Agents use familiar `ls`, `cat`, `write`, `rm`, `grep` operations.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `packages/gateway` | `@nkmc/gateway` | Core gateway logic: registry, vault, federation, proxy, tunnel |
| `packages/agent-fs` | `@nkmc/agent-fs` | Virtual filesystem layer: mounts, backends (HTTP, JSON-RPC), parser |
| `packages/server` | `@nkmc/server` | Standalone Node.js server with SQLite, migrations, key generation |

Related SDK packages (in [nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)):

| Package | npm | Description |
|---------|-----|-------------|
| `packages/cli` | `@nkmc/cli` | CLI tool (`nkmc`) for interacting with gateways |
| `packages/core` | `@nkmc/core` | Shared types, JWT signing, skill.md generation |

## CLI Commands

| Command | Description |
|---------|-------------|
| `nkmc auth` | Authenticate with a gateway and save JWT token |
| `nkmc init` | Scaffold `nkmc.config.ts` for a project |
| `nkmc generate` | Scan routes/schema and generate `.well-known/skill.md` |
| `nkmc register --url <url>` | Auto-discover OpenAPI spec and register a service |
| `nkmc register --domain <d>` | Register a service from a local `skill.md` |
| `nkmc claim <domain>` | Request DNS TXT challenge for domain ownership |
| `nkmc claim <domain> --verify` | Verify DNS challenge and obtain publish token |
| `nkmc ls <path>` | List entries at a virtual path |
| `nkmc cat <path>` | Read data from a virtual path |
| `nkmc write <path> <data>` | Write data to a virtual path |
| `nkmc rm <path>` | Remove a resource at a virtual path |
| `nkmc grep <pattern> <path>` | Search services or endpoints |
| `nkmc pipe "cat /a \| write /b"` | Pipe data between two paths |
| `nkmc run <tool> [args...]` | Proxy a CLI tool (e.g. `gh`, `stripe`) |
| `nkmc keys set <domain>` | Store an API key in the gateway vault (encrypted) |
| `nkmc keys list` | List stored API keys |
| `nkmc keys remove <domain>` | Remove an API key |
| `nkmc gateway start` | Start a local gateway server |
| `nkmc gateway start --tunnel` | Start with Cloudflare Tunnel for public access |
| `nkmc gateway start --daemon` | Start as a background process |
| `nkmc gateway stop` | Stop the background gateway |
| `nkmc gateway status` | Show gateway process and tunnel info |
| `nkmc peers add` | Add a peer gateway for federation |
| `nkmc peers list` | List configured peer gateways |
| `nkmc peers remove <id>` | Remove a peer gateway |
| `nkmc peers discover` | Discover online gateways via tunnel network |
| `nkmc rules set <domain>` | Set a credential lending rule |
| `nkmc rules list` | List all lending rules |
| `nkmc rules remove <domain>` | Remove a lending rule |

## Federation

Gateways can peer with each other to share credential access across a network.

**Adding a peer:**

```bash
nkmc peers add \
  --id peer-alice \
  --name "Alice's Gateway" \
  --url https://alice.tunnel.nkmc.ai \
  --secret shared-secret-value
```

**Lending rules** control which credentials can be shared with which peers:

```bash
# Allow all peers to use your OpenAI key for free
nkmc rules set api.openai.com --allow --peers '*' --pricing free

# Allow only specific peers, charge per request
nkmc rules set api.stripe.com --allow --peers peer-alice,peer-bob \
  --pricing per-request --amount 0.01

# Deny lending for a domain
nkmc rules set github.com --deny
```

**How it works:**

1. Agent requests `cat /api.openai.com/models` on the local gateway
2. Local gateway checks its vault -- no credential found
3. Gateway queries peers: `POST /federation/query { domain: "api.openai.com" }`
4. Peer responds: `{ available: true, pricing: { mode: "free" } }`
5. Local gateway delegates execution to peer: `POST /federation/exec { command: "cat /api.openai.com/models" }`
6. Peer injects its own credential, makes the API call, and returns the result
7. Keys never leave the peer gateway

**Pricing modes:**

| Mode | Description |
|------|-------------|
| `free` | No charge |
| `per-request` | Fixed USD amount per request |
| `per-token` | USD amount per token (for LLM APIs) |

Paid requests use the x402 payment protocol (header `X-402-Payment`).

## Security

- **AES-GCM encryption** -- All credentials in the vault are encrypted with a 256-bit AES-GCM key. Each entry uses a unique 12-byte IV.
- **File permissions** -- Sensitive files (`keys.json`, `encryption.key`, `admin-token`) are set to `0600` (owner read/write only).
- **JWT authentication** -- Agents authenticate with EdDSA (Ed25519) signed JWTs. The gateway exposes its public key at `/.well-known/jwks.json`.
- **Keys never leave the gateway** -- The vault decrypts credentials at request time, injects them into the outbound API call or subprocess env, and discards them. Raw keys are never sent to agents.
- **BYOK isolation** -- Each agent's BYOK credentials are scoped to their agent ID. Agents cannot access other agents' keys.
- **Pool vs BYOK priority** -- BYOK credentials take precedence over pool credentials when both exist for a domain.
- **Federation boundary** -- Peer gateways execute requests on behalf of the requesting gateway. The lending gateway injects its own credentials; they are never transmitted to the requesting peer.

## Configuration

The server reads configuration from environment variables and an optional `config.json` file in the data directory.

| Variable | Default | Description |
|----------|---------|-------------|
| `NKMC_PORT` | `9090` | Server listen port |
| `NKMC_HOST` | `0.0.0.0` | Server listen host |
| `NKMC_DATA_DIR` | `~/.nkmc/server` | Data directory (SQLite DB, keys, config) |
| `NKMC_ADMIN_TOKEN` | (auto-generated) | Admin token for credential management |
| `NKMC_ENCRYPTION_KEY` | (auto-generated) | Base64-encoded 256-bit AES key for vault |
| `NKMC_GATEWAY_PRIVATE_KEY` | (auto-generated) | EdDSA private key (JWK JSON) |
| `NKMC_GATEWAY_PUBLIC_KEY` | (auto-generated) | EdDSA public key (JWK JSON) |
| `NKMC_GATEWAY_URL` | `https://nkmc.ai` | Gateway URL (used by CLI) |
| `NKMC_GATEWAY_NAME` | (none) | Display name for tunnel discovery |

Auto-generated values are persisted in the data directory with `0600` permissions on first run.

## HTTP API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/.well-known/jwks.json` | Public | Gateway public key (JWKS) |
| `POST` | `/auth/token` | Public | Issue a JWT for an agent |
| `POST` | `/domains/challenge` | Public | Request DNS TXT challenge |
| `POST` | `/domains/verify` | Public | Verify DNS challenge |
| `POST` | `/registry/services` | Publish/Admin | Register a service (skill.md) |
| `POST` | `/registry/services/discover` | Publish/Admin | Auto-discover and register |
| `GET` | `/credentials` | Admin | List vault domains |
| `PUT` | `/credentials/:domain` | Admin | Set pool credential |
| `DELETE` | `/credentials/:domain` | Admin | Delete pool credential |
| `PUT` | `/byok/:domain` | Agent JWT | Upload BYOK credential |
| `GET` | `/byok` | Agent JWT | List BYOK domains |
| `DELETE` | `/byok/:domain` | Agent JWT | Delete BYOK credential |
| `POST` | `/execute` | Agent JWT | Execute a filesystem command |
| `POST` | `/proxy/exec` | Agent JWT | Execute a CLI tool with injected credentials |
| `GET` | `/proxy/tools` | Agent JWT | List available proxy tools |
| `GET` | `/admin/federation/peers` | Admin | List peer gateways |
| `PUT` | `/admin/federation/peers/:id` | Admin | Add/update peer |
| `DELETE` | `/admin/federation/peers/:id` | Admin | Remove peer |
| `GET` | `/admin/federation/rules` | Admin | List lending rules |
| `PUT` | `/admin/federation/rules/:domain` | Admin | Set lending rule |
| `DELETE` | `/admin/federation/rules/:domain` | Admin | Remove lending rule |
| `POST` | `/federation/query` | Peer | Query credential availability |
| `POST` | `/federation/exec` | Peer | Execute command on behalf of peer |
| `POST` | `/federation/announce` | Peer | Announce advertised domains |
| `POST` | `/tunnels/create` | Agent JWT | Create a Cloudflare Tunnel |
| `DELETE` | `/tunnels/:id` | Agent JWT | Delete a tunnel |
| `GET` | `/tunnels` | Agent JWT | List agent's tunnels |
| `GET` | `/tunnels/discover` | Agent JWT | Discover online gateways |
| `POST` | `/tunnels/heartbeat` | Agent JWT | Update tunnel heartbeat |

## Development

```bash
# Clone
git clone https://github.com/nkmc-ai/gateway.git
cd gateway

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm lint
```

## Links

- **GitHub**: [nkmc-ai/gateway](https://github.com/nkmc-ai/gateway) | [nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)
- **npm**: [@nkmc/gateway](https://www.npmjs.com/package/@nkmc/gateway) | [@nkmc/agent-fs](https://www.npmjs.com/package/@nkmc/agent-fs) | [@nkmc/server](https://www.npmjs.com/package/@nkmc/server) | [@nkmc/cli](https://www.npmjs.com/package/@nkmc/cli) | [@nkmc/core](https://www.npmjs.com/package/@nkmc/core)

## License

MIT
