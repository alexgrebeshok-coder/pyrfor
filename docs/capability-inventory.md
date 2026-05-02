# Capability Inventory

Machine-readable source: [`capability-inventory.json`](./capability-inventory.json)

Last updated: 2026-05-01 (Engine/App boundary cleanup)

---

## Pyrfor — Local-first AI Coding Control Plane

| Capability | Files (key) | Status | Tests | Notes |
|---|---|---|---|---|
| Subagent Spawner | `runtime/subagents.ts` | ✅ production | 72 | Full lifecycle, worktree isolation |
| MCP Server | `runtime/mcp-server.ts`, `pyrfor-mcp-server-fc.ts` | ✅ production | 11 | 146 lines + FC bridge |
| MCP Client | `runtime/mcp-client.ts` | ✅ production | 25 | 386 lines |
| A2A Protocol | `runtime/a2a-client.ts`, `pyrfor-a2a-fc.ts` | ✅ production | 26 | 321 + 195 lines |
| Memory Store (SQLite + FTS5) | `runtime/memory-store.ts` | ✅ production | 36 | 509 lines, FTS5 search |
| Prisma Memory Manager | `memory/prisma-memory-manager.ts` | ✅ production | — | 461 lines |
| LLM Provider Router | `runtime/llm-provider-router.ts` | ✅ production | 66 | 13-file router system |
| Circuit Breaker Router | `runtime/pyrfor-fc-circuit-router.ts` | ✅ production | 8 | FC provider chains |
| Multimodal Router | `runtime/multimodal-router.ts` | ✅ production | 42 | Modality-based dispatch |
| Config + Hot-reload | `runtime/config.ts` | ✅ production | 48 | fs.watch + debounce, canonical `~/.pyrfor/runtime.json` |
| Engine Gateway (HTTP + WS) | `runtime/gateway.ts` | ✅ production | 71 | Canonical desktop gateway under `packages/engine/src/runtime` |
| Compatibility Daemon | `daemon/gateway.ts` | 🔶 beta | — | Compatibility/service wrapper, not the Pyrfor.app backend |
| Voice (Whisper/Telegram) | `daemon/telegram/voice.ts` | 🔶 beta | — | 175 lines, Whisper STT |
| Local LLM Providers (Ollama + MLX) | `ai/providers/ollama.ts`, `mlx.ts` | ✅ production | — | Both providers with tests |
| Tauri Desktop IDE | `apps/pyrfor-ide/src-tauri/` | 🔶 beta | — | v0.2.0 release, 16 MB |
| CEOClaw MCP Bridge | `runtime/pyrfor-ceoclaw-mcp-fc.ts` | 🔧 prototype | — | Task/run event bridge |
| **Run Lifecycle State Machine** | — | ❌ missing | — | New work: state machine |
| **Event Ledger (JSONL)** | — | ❌ missing | — | New work: append-only log |
| **Permission Engine** | — | ❌ missing | — | New work: permission ladder |
| **Artifact Model** | — | ❌ missing | — | New work: typed artifacts |
| **MCP Tool Adapter** | — | ❌ missing | — | New work: tool engine bridge |
| **FTS5 Search Public API** | — | ❌ missing | — | New work: HTTP/IPC surface |
| **OTel Observability** | — | ❌ missing | — | New work: traces/metrics |
| **Browser MCP** | — | ❌ missing | — | New work: browser automation |

---

## CEOClaw — Vertical PM/Ops Control Plane (Construction/Operations)

| Capability | Files (key) | Status | Tests | Notes |
|---|---|---|---|---|
| AI Kernel (Waves A–H) | `lib/ai/`, `app/api/ai/` | ✅ production | — | 10 providers, multi-agent |
| Orchestration API Routes | `app/api/agents/`, `heartbeat/`, `goals/`, `workflows/` | ✅ production | — | 268 route dirs, 222+ routes |
| Heartbeat Executor + Scheduler | `lib/scheduling/`, `app/api/heartbeat/` | ✅ production | — | Retry + circuit breaker |
| Agent UI Pages | `app/agents/`, `app/goals/`, `app/gantt/`, `app/kanban/` | ✅ production | — | 10 pages |
| PM Layer (Projects / Tasks / Kanban) | `app/kanban/`, `app/gantt/`, `app/goals/` | ✅ production | — | Full PM suite |
| Finance / Analytics | `app/finance/`, `app/analytics/`, `lib/evm/` | ✅ production | — | EVM, budget, dashboards |
| LightRAG POC | `lib/knowledge/` | 🔧 prototype | — | Ollama + qwen2.5:3b |
| SSE Broadcasting | `lib/transport/` | ✅ production | — | Live UI updates |
| Prisma / Postgres Schema | `prisma/schema.prisma` | ✅ production | — | Full domain schema |
| Evidence Ledger | `app/evidence/`, `app/api/evidence/` | 🔧 prototype | — | UI + API exist; needs hardening |
| **CEOClaw Client (Pyrfor integration)** | — | ❌ missing | — | New work: bidirectional task sync |

---

## FreeClaude — Autonomous Execution Kernel + CLI

| Capability | Files (key) | Status | Tests | Notes |
|---|---|---|---|---|
| CLI Core | `src/`, `bin/`, `dist/cli.mjs` | ✅ production | — | 90%, 18+ providers |
| Multi-provider Fallback | `src/providers/` | ✅ production | — | 95%, circuit breaking |
| FS Memory (Vault) | `src/`, `skills/` | 🔧 prototype | — | 85%, GBrain + vault |
| OpenClaw Plugin | `openclaw-plugin/index.mjs` | 🔶 beta | — | 80%, workspace governance |
| MCP Servers (CEOClaw PM + 1С OData) | `mcp-servers/` | ✅ production | — | 11 tools total |
| Hook System | `src/hooks/` | ✅ production | — | 5 built-in safety hooks |
| Task Protocol (Prototype) | `src/` | 🔧 prototype | — | `task run/list/cancel --json` |
| **VSCode Extension** | `extension/src/extension.ts` | ❌ missing | — | Stub only, 25% complete |
| **FreeClaude Mode (IDE Integration)** | — | ❌ missing | — | New work: engine → Pyrfor IDE |
| **Slash Commands (extended registry)** | — | ❌ missing | — | New work: structured registry |
| **Memory Bridge (Pyrfor ↔ FreeClaude)** | — | ❌ missing | — | New work: vault ↔ SQLite sync |
| **Session Store** | — | ❌ missing | — | New work: structured persistence |
| **Evals Framework** | — | ❌ missing | — | New work: automated quality evals |
| **Specialist Subagent: repo-mapper** | — | ❌ missing | — | New work |
| **Specialist Subagent: test-fixer** | — | ❌ missing | — | New work |
| **Specialist Subagent: security-reviewer** | — | ❌ missing | — | New work |
| **Specialist Subagent: pm-summarizer** | — | ❌ missing | — | New work |

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ production | Wired, tested, and in use |
| 🔶 beta | Functional but needs polish |
| 🔧 prototype | Exists, not production-hardened |
| ❌ missing | Does not exist; new work required |
| — | Count not applicable or not measured |
