# Pyrfor

Open runtime infrastructure for AI agents, with the public engine package, the standalone daemon, and the companion `apps/pyrfor-ide` desktop shell.

## What lives here

| Surface | Purpose |
| --- | --- |
| `packages/engine` | Public runtime package and shared AI/kernel primitives |
| `daemon/` | Long-running gateway, cron, Telegram, voice, and service management |
| `apps/pyrfor-ide` | Native Tauri IDE built around the Pyrfor runtime |
| `prisma/` | Shared schema used by runtime services |
| `config/` | Runtime agent and plugin manifests |

## Quick start

```bash
git clone https://github.com/alexgrebeshok-coder/pyrfor.git
cd pyrfor

pnpm install
pnpm build
pnpm daemon
```

By default the daemon uses `~/.pyrfor/pyrfor.json`. Legacy `~/.ceoclaw/ceoclaw.json` is still read automatically if present.

## Key workflows

```bash
# Engine package
pnpm --filter @pyrfor/engine typecheck
pnpm --filter @pyrfor/engine test
pnpm --filter @pyrfor/engine build

# Daemon
pnpm daemon
pnpm daemon:status

# IDE
cd apps/pyrfor-ide/web && npm ci && npm run build
```

## Repository role

This repository is no longer the mirrored CEOClaw monorepo. Dashboard code, product UI, and unrelated product packages were split away so this repo can stay focused on Pyrfor runtime surfaces.
