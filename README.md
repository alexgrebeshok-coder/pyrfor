# Pyrfor

[![SWE-bench nightly smoke](https://github.com/alexgrebeshok-coder/pyrfor/actions/workflows/swe-bench-scheduled.yml/badge.svg)](https://github.com/alexgrebeshok-coder/pyrfor/actions/workflows/swe-bench-scheduled.yml)

**Community:** [Documentation](https://docs.pyrfor.dev) · [Discord](https://discord.gg/pyrfor) · [Telegram](https://t.me/pyrfor) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

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

## Universal Engine quick path

Pyrfor already ships the governed Universal Engine surface by default. The fastest sanity-check path is:

```bash
# Start the canonical runtime / gateway
pnpm runtime

# In another terminal, dispatch a concept through the CLI
node packages/cli/dist/index.js concept "Build a tiny hello-world script" --json

# Inspect governed concept state
node packages/cli/dist/index.js concept status <conceptId> --json
node packages/cli/dist/index.js concept trace <conceptId> --json
node packages/cli/dist/index.js concept export <conceptId> --incident-packet --json

# Review pending approvals if the run escalates
node packages/cli/dist/index.js approvals list --json
```

The engine lifecycle now runs through `plan → research → execute → critique → postmortem → memory_persist → done`, so successful and failed governed runs both produce postmortem and historian-backed memory artifacts.

## OpenClaw migration quick path

OpenClaw is treated as a migration / compatibility input, not as Pyrfor's runtime backend. The current migration flow is:

```bash
# Preview importability before mutating memory
node packages/cli/dist/index.js migrate openclaw --from ~/openclaw-workspace --dry-run --json

# Execute the migration once the report looks correct
node packages/cli/dist/index.js migrate openclaw --from ~/openclaw-workspace --import --json

# Audit / verify / rollback the result artifact if needed
node packages/cli/dist/index.js migrate audit --json
node packages/cli/dist/index.js migrate verify --result-artifact-id <id> --expected-sha256 <sha> --json
node packages/cli/dist/index.js migrate rollback --result-artifact-id <id> --expected-sha256 <sha> --json
```

For the detailed contracts behind these flows, see `docs/universal-engine/09-api-cli-vscode.md`.

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

### Benchmarks

Pyrfor tracks **[SWE-bench](https://github.com/princeton-nlp/SWE-bench)** harness compatibility separately from product scores.

| Track | Command / workflow | Metrics |
| --- | --- | --- |
| Smoke | `pnpm swe-bench:smoke` + `node scripts/swe-bench/smoke.mjs --ci` | Repo sanity + tooling checks (no task execution) |
| Lite baseline (subset) | `pnpm swe-bench:baseline` (+ optional `--run` with `SWE_BENCH_CLONE`) | Curated instance IDs in [`scripts/swe-bench/lite-subset.json`](scripts/swe-bench/lite-subset.json); full resolve/score **TBD** (document commit + date when published) |

Upstream dataset reference: [SWE-bench Lite on Hugging Face](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite).

**CI:** [`swe-bench-smoke.yml`](.github/workflows/swe-bench-smoke.yml) (`workflow_dispatch`) and nightly [`swe-bench-scheduled.yml`](.github/workflows/swe-bench-scheduled.yml) run install + smoke + `--ci` verification.

`pnpm swe-bench:smoke` prints upstream setup steps; use `node scripts/swe-bench/smoke.mjs --verify` to assert `git` and (if set) `SWE_BENCH_CLONE`. No API keys are required for that default path — agent evaluation runs need your harness’s provider credentials.

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
