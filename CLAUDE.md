# Pyrfor

Local-first AI coding workspace: `Pyrfor.app` is the desktop product and `packages/engine/src/runtime` is its canonical runtime.

## Structure

- `apps/pyrfor-ide` — Tauri desktop application and primary product shell
- `packages/engine` — Runtime core; `src/runtime` owns the canonical gateway, memory, tools, MCP, and sidecar entrypoint
- `daemon/` — Compatibility/service wrapper for legacy daemon and optional Telegram flows, not a co-equal desktop backend
- `prisma/` — Shared database schema

## Stack

TypeScript, pnpm, Next.js, Tauri, Prisma, SQLite, WebSocket, Grammy

## Install & Run

```bash
pnpm install
pnpm build
pnpm runtime:dev
```

Runtime config: `~/.pyrfor/runtime.json`
