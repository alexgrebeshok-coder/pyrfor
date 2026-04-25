# Pyrfor

Open runtime infrastructure for AI agents — engine package, standalone daemon, and desktop IDE.

## Structure

- `packages/engine` — Runtime core (Memory, Skills, MCP, Tool Engine)
- `daemon/` — Gateway, cron, Telegram, voice, service management
- `apps/pyrfor-ide` — Tauri desktop application
- `prisma/` — Shared database schema

## Stack

TypeScript, pnpm, Next.js, Tauri, Prisma, SQLite, WebSocket, Grammy

## Install & Run

```bash
pnpm install
pnpm build
pnpm daemon
```

Daemon config: `~/.pyrfor/pyrfor.json`
