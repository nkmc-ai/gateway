# @nkmc/server

> The gateway of internet for all agents. NaKaMiChi - the middle path, the right path.

Standalone Node.js gateway server with SQLite. Run your own gateway in one command.

## Part of the [nkmc gateway](https://github.com/nkmc-ai/gateway)

```bash
npm install -g @nkmc/cli @nkmc/server
nkmc gateway start
```

## What it does

- **Zero config** — Auto-generates encryption keys, admin token, and JWT keypair on first run
- **SQLite storage** — Credentials encrypted with AES-GCM, WAL mode for performance
- **Embeddable** — `startServer()` export for programmatic use
- **Tunnel ready** — `nkmc gateway start --tunnel` for public access via Cloudflare Tunnel

## Links

- [Gateway repo](https://github.com/nkmc-ai/gateway)
- [Full reference](https://nkmc.ai/skill.md)
