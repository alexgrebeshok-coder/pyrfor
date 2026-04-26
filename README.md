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

---

## Canonical Role

**Pyrfor is the local-first AI coding control plane.**

It owns the desktop IDE (Tauri), the local daemon/runtime, the MCP gateway, workspace memory (SQLite + FTS5), the tool/permission engine, the event ledger, and the subagent lifecycle. All AI execution that touches the local file system, process tree, or IDE surfaces runs through Pyrfor.

| Surface | Description |
|---------|-------------|
| Desktop IDE (Tauri) | Native IDE shell built on Tauri + web renderer |
| Daemon / Gateway | HTTP + WebSocket gateway, session manager, cron, health |
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
| **FreeClaude** | Autonomous execution kernel + CLI; provider routing and budget policies | FreeClaude Engine runs as a local service; Pyrfor daemon routes tasks to it via the FC adapter layer |
| **CEOClaw** | Vertical PM/Ops control plane (construction/operations); task DAGs, approval queues, evidence ledger | CEOClaw pushes task/run events to Pyrfor via `pyrfor-ceoclaw-mcp-fc.ts`; Pyrfor reports execution state back |
| **OpenClaw** | Workspace governance, PM/QA discipline, memory rules (not a runtime product) | Used as a plugin/config layer by FreeClaude; not a direct runtime dependency of Pyrfor |
