# Pyrfor

Local-first AI coding workspace: `Pyrfor.app` is the desktop product and `packages/engine/src/runtime` is its canonical runtime.

## What lives here

| Surface | Purpose |
| --- | --- |
| `apps/pyrfor-ide` | Primary Tauri desktop shell for Pyrfor.app |
| `packages/engine` | Public engine package; `src/runtime` is the canonical desktop runtime |
| `daemon/` | Compatibility/service wrapper for legacy daemon and optional Telegram flows; not the desktop backend |
| `prisma/` | Shared schema for optional Postgres-backed service/integration flows |
| `config/` | Runtime agent and plugin manifests |

## Quick start

```bash
git clone https://github.com/alexgrebeshok-coder/pyrfor.git
cd pyrfor

pnpm install
pnpm runtime:dev
```

By default the engine runtime uses `~/.pyrfor/runtime.json`. Legacy paths are compatibility/migration inputs only, not the first-run desktop contract.

## Key workflows

```bash
# Engine package
pnpm --filter @pyrfor/engine typecheck
pnpm --filter @pyrfor/engine test
pnpm --filter @pyrfor/engine build

# Canonical runtime
pnpm runtime:dev
pnpm runtime

# IDE
npm --prefix apps/pyrfor-ide/web ci
pnpm ide:build:web
pnpm ide:build:sidecar

# First-run readiness gate
pnpm qa:first-run

# Compatibility daemon wrapper
pnpm daemon
pnpm daemon:status
```

## Repository role

This repository is no longer the mirrored CEOClaw monorepo. Dashboard code, product UI, and unrelated product packages were split away so this repo can stay focused on Pyrfor runtime surfaces.

Optional adapters such as Telegram, FreeClaude, CEOClaw and 1C OData are documented in `docs/integrations.md`; none of them are required for first-run desktop startup.

---

## Canonical Role

**Pyrfor is the local-first AI coding control plane.**

It owns the desktop IDE (Tauri), the canonical engine runtime, the MCP gateway, workspace memory (SQLite + FTS5), the tool/permission boundary, and the subagent lifecycle. All AI execution that touches the local file system, process tree, or IDE surfaces must go through `packages/engine/src/runtime`.

| Surface | Description |
|---------|-------------|
| Desktop IDE (Tauri) | Native IDE shell built on Tauri + web renderer |
| Engine Runtime / Gateway | Canonical HTTP + WebSocket gateway, session manager, cron, health (`packages/engine/src/runtime`) |
| Compatibility Daemon | Legacy/service wrapper under `daemon/`; not a co-equal backend for Pyrfor.app |
| MCP Gateway | Server (`mcp-server.ts`) + client (`mcp-client.ts`) + FC bridge (`pyrfor-mcp-server-fc.ts`) |
| Subagent Lifecycle | Typed spawner, worktree isolation, supervision (`subagents.ts`) |
| Memory | SQLite + FTS5 (`memory-store.ts`) + Prisma (`prisma-memory-manager.ts`) |
| Provider Router | 13-file router, circuit breaker, multimodal (`llm-provider-router.ts`, `pyrfor-fc-circuit-router.ts`, `multimodal-router.ts`) |
| A2A Protocol | Agent-to-agent client + FC integration (`a2a-client.ts`, `pyrfor-a2a-fc.ts`) |
| Config / Hot-reload | `fs.watch` + debounce (`config.ts`) |
| Voice | Whisper STT via Telegram (`daemon/telegram/voice.ts`) |
| Local LLMs | Ollama + MLX providers (`packages/engine/src/ai/providers/`) |

### Relationship to other repos

| Repo | Role | Integration point |
|------|------|-------------------|
| **FreeClaude** | Autonomous execution kernel + CLI; provider routing and budget policies | Optional adapter over the canonical Pyrfor runtime |
| **CEOClaw** | Vertical PM/Ops control plane (construction/operations); task DAGs, approval queues, evidence ledger | Optional bridge via `pyrfor-ceoclaw-mcp-fc.ts`; does not define the desktop first-run path |
| **OpenClaw** | Workspace governance and legacy memory/config source | Migration/compatibility input only; not a direct runtime dependency of Pyrfor.app |
