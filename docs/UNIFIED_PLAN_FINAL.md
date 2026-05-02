# 🎯 Unified Final Plan 2026 Q2-Q3: Pyrfor + FreeClaude + CEOClaw

> **Archive note (2026-05-01):** this document is historical strategy context. The active Pyrfor execution truth is the Engine/App boundary plan: `Pyrfor.app` is the product, `packages/engine/src/runtime` is the canonical runtime, and `daemon/` is a compatibility/service wrapper rather than the desktop backend. Prefer the root `README.md`, `CLAUDE.md`, `packages/engine/README.md`, and `packages/engine/src/runtime/README.md` for current run/build guidance.

**Дата:** 27.04.2026 (финальная редакция)  
**Период:** Май — Август 2026 (16 недель)  
**Автор:** Клод Гребешок (объединение планов Copilot GPT-5.5 + FreeClaude GLM-5.1)  
**Версия:** FINAL — объединённый план на основе аудита кода, GitHub releases и реального состояния

---

## 1. Executive Summary

**Стратегия:** Три продукта — один стек. Pyrfor + FreeClaude = local-first AI coding control plane. CEOClaw = вертикальный PM/Ops слой для строительства/операций.

**Главная новость:** Кодовая база значительно зрелее, чем предполагали оба плана. После полного аудита:

| Что планировали с нуля | Реальность | Экономия |
|------------------------|------------|----------|
| Subagents (64ч) | ✅ 390 строк, 72 теста, полная lifecycle | −64ч |
| MCP Server (28ч) | ✅ 146 строк, 11 тестов | −28ч |
| MCP Client (44ч) | ✅ 386 строк, 25 тестов | −44ч |
| A2A Protocol (20ч) | ✅ 516 строк + 707 строк тестов | −20ч |
| SQLite Memory (28ч) | ✅ 509 строк + Prisma, 36+ тестов | −28ч |
| Provider Router (16ч) | ✅ 13 файлов, circuit breaker | −16ч |
| Config hot-reload (8ч) | ✅ fs.watch + debounce в config.ts | −8ч |
| CEOClaw heartbeat | ✅ executor + scheduler + UI pages | −16ч |
| CEOClaw agent pages | ✅ 10 страниц (agents, heartbeat, workflows, runs) | −12ч |
| **ИТОГО ЭКОНОМИЯ** | | **−236ч** |

**Фокус плана** — НЕ на том что уже работает, а на:
1. **VSCode Extension** — единственный крупный компонент с нуля
2. **FreeClaude Mode** — интеграция движка в IDE
3. **Контракты** — run lifecycle, event ledger, permission ladder (от Copilot)
4. **CEOClaw ↔ Pyrfor интеграция** — замкнуть loop
5. **Eval + Release quality** — финализация до v1.0

---

## 2. Verified Current State (аудит 26-27.04.2026)

### 2.1 Pyrfor — GitHub v0.2.0 (26.04.2026)

#### ✅ Полностью работает (проверено файлами + тестами)

| Компонент | Файл | Строк | Тестов |
|-----------|------|-------|--------|
| **Subagent Spawner** | `packages/engine/src/runtime/subagents.ts` | 390 | 72 ✅ |
| **MCP Server** | `packages/engine/src/runtime/mcp-server.ts` | 146 | 11 ✅ |
| **MCP Client** | `packages/engine/src/runtime/mcp-client.ts` | 386 | 25 ✅ |
| **MCP FC Integration** | `packages/engine/src/runtime/pyrfor-mcp-server-fc.ts` | — | — |
| **A2A Client** | `packages/engine/src/runtime/a2a-client.ts` | 321 | ✅ |
| **A2A FC Integration** | `packages/engine/src/runtime/pyrfor-a2a-fc.ts` | 195 | ✅ |
| **A2A Tests** | `a2a-client.test.ts + pyrfor-a2a-fc.test.ts` | 707 | ✅ |
| **Memory Store (SQLite+FTS5)** | `packages/engine/src/runtime/memory-store.ts` | 509 | 36 ✅ |
| **Prisma Memory** | `packages/engine/src/memory/prisma-memory-manager.ts` | 461 | ✅ |
| **Provider Router** | `llm-provider-router.ts` + 12 файлов | — | ✅ |
| **Circuit Breaker Router** | `pyrfor-fc-circuit-router.ts` | — | ✅ |
| **Multimodal Router** | `multimodal-router.ts` | — | ✅ |
| **Gateway (HTTP+WS)** | `daemon/gateway.ts` | 393 | ✅ |
| **Voice (Whisper)** | `daemon/telegram/voice.ts` | 175 | ✅ |
| **Local LLM (Ollama+MLX)** | `packages/engine/src/ai/providers/` | — | ✅ |
| **Config + hot-reload** | `packages/engine/src/runtime/config.ts` | — | ✅ fs.watch + debounce |
| **Tauri IDE** | `apps/pyrfor-ide/src-tauri/` | 16MB | v0.2.0 release |

**Всего тестов Pyrfor:** 209 файлов `.test.ts`

#### ❌ Нужно создать с нуля

| Компонент | Оценка | Приоритет |
|-----------|--------|-----------|
| **VSCode Extension** | 40ч | P1 — единственный полностью новый компонент |
| **FreeClaude Mode в IDE** | 32ч | P1 — ключевой режим |
| **Run Lifecycle Contract** | 16ч | P1 — canonical state machine |
| **Event Ledger (JSONL)** | 20ч | P1 — append-only execution truth |
| **Permission Ladder** | 16ч | P2 — auto-allow / ask-once / ask-every-time |
| **Artifact Model** | 12ч | P2 — типизированные артефакты |

#### ⚠️ Нужна доработка

| Компонент | Что нужно | Оценка |
|-----------|-----------|--------|
| **MCP → Tool Engine** | Адаптер подключения MCP tools к Tool Engine | 12ч |
| **FTS5 Search API** | Публичный API поверх memory-store | 8ч |
| **Tauri IDE UI** | Доработка режимов, улучшение UX | 24ч |

### 2.2 FreeClaude — CLI 90%, Desktop 30%

| Компонент | Статус | Примечание |
|-----------|--------|------------|
| **CLI** | ✅ 90% | 18+ провайдеров |
| **Multi-provider fallback** | ✅ 95% | Цепочки fallback |
| **Memory system (FS)** | ✅ 85% | Файловая система |
| **OpenClaw plugin** | ✅ 80% | Интеграция |
| **VSCode Extension** | ⚠️ 25% | `extension/src/extension.ts` — stub subprocess-only |
| **Desktop (Tauri)** | ❌ 30% | Концепт, нет `src-tauri/` |

### 2.3 CEOClaw — GitHub v1.0.0 (20.03.2026)

#### ✅ Гораздо больше, чем предполагали оба плана

| Компонент | Статус | Детали |
|-----------|--------|--------|
| **AI Kernel (Waves A-H)** | ✅ Работает | 10 провайдеров, multi-agent runtime |
| **Orchestration API** | ✅ 222 API routes | agents, heartbeat, goals, workflows |
| **Heartbeat Executor** | ✅ Полный | executor + scheduler + retry + circuit breaker |
| **Agent UI Pages** | ✅ 10 страниц | dashboard, heartbeat, workflows, runs, goals, org-chart, templates |
| **PM Layer** | ✅ Работает | Projects, tasks, kanban, milestones, risks |
| **Finance/Analytics** | ✅ Есть страницы | finance, analytics |
| **LightRAG POC** | ✅ Работает | Ollama + qwen2.5:3b |
| **SSE Broadcasting** | ✅ Работает | Live UI updates |
| **Vercel Deploy** | ✅ Live | https://ceoclaw-dev.vercel.app |
| **Prisma/Postgres** | ✅ Полная схема | AIProvider, Agent, HeartbeatRun, Goal, Task... |

#### ❌ Нужно сделать

| Компонент | Оценка | Приоритет |
|-----------|--------|-----------|
| **Telegram Bot (full)** | 24ч | P2 — уведомления + commands |
| **Pyrfor Integration API** | 16ч | P1 — task sync, run events |
| **Evidence Ledger** | 12ч | P2 — PM/Ops решения |

---

## 3. Strategy & Positioning

### 3.1 Product Stack

```
┌─────────────────────────────────────────────────────────────┐
│                  USER SURFACES                               │
│  Pyrfor IDE (Tauri)  │  VSCode Extension  │  FreeClaude CLI │
├───────────────────────┼────────────────────┼─────────────────┤
│              PYRFOR LOCAL RUNTIME                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Daemon   │ │ Session  │ │ Memory   │ │ Permission    │  │
│  │ Gateway  │ │ Manager  │ │ (SQLite) │ │ Engine        │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Subagents│ │ MCP      │ │ Tool     │ │ Event Ledger  │  │
│  │ (5 max)  │ │ Gateway  │ │ Executor │ │ (JSONL)       │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │           FREECLAUDE ENGINE SERVICE                      ││
│  │  Provider Router │ Fallback │ Budget │ Privacy Policy   ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│              CEOCLAW CONTROL PLANE (Cloud)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Task DAG │ │ Approval │ │ Evidence │ │ Schedule/     │  │
│  │ & Goals  │ │ Queue    │ │ Ledger   │ │ Budget/Risk   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Canonical Product Boundaries

**Pyrfor владеет:**
- Desktop IDE (Tauri) и VSCode companion
- Local runtime: daemon, sessions, memory, tools, permissions
- MCP gateway, subagent lifecycle, diff/apply/revert
- Workspace state, local memory, repo index
- Event ledger, artifact store

**FreeClaude владеет:**
- Provider routing, fallback, circuit breaking
- Budget policies, privacy modes
- Autonomous execution loop
- Task/event ledger format
- CLI surface, specialist subagent manager

**CEOClaw владеет:**
- Projects, goals, tasks, task DAGs
- Approval queues, heartbeat, schedules
- Evidence ledger, budget/risk analytics
- Executive dashboards, org-level telemetry
- Vertical: строительство/операции, 1C интеграция

### 3.3 Competitive Differentiation

| Что делают конкуренты | Наше преимущество |
|-----------------------|-------------------|
| Cursor/Windsurf: opaque pricing, cloud-only | **Local-first, transparent cost/budget** |
| Copilot: no task DAG, no PM loop | **CEOClaw: goal → task → execution → evidence** |
| Claude Code: single-agent, no subagents | **Typed subagents with isolated worktrees** |
| Devin: cloud-only, no privacy | **Local-first privacy, no-training posture** |
| Generic coding tools: weak domain PM | **Vertical construction/operations PMO** |

**Defensible wedge:** business goal → task DAG → autonomous execution → artifact/PR → approval → executive dashboard

---

## 4. Canonical Contracts (from Copilot)

### 4.1 Run Lifecycle

Единая state machine для всего стека:

```
draft → planned → awaiting_approval → running → blocked → completed
                                         └→ failed
                                         └→ cancelled
completed/failed/cancelled → replayable → archived
```

**Каждый run включает:**
- `run_id`, `task_id`, `parent_run_id`
- `workspace_id`, `repo_id`, `branch_or_worktree_id`
- `mode`: `chat | edit | autonomous | pm`
- `model_profile`, `provider_route`
- `permission_profile`, `budget_profile`
- `context_snapshot_hash`, `prompt_snapshot_hash`
- `artifact_refs`, `final_diff_ref`, `status`

**Где хранить:** `packages/engine/src/runtime/run-lifecycle.ts` (новый)

### 4.2 Event Ledger

Append-only JSONL — единая execution truth:

```jsonl
{"ts":"2026-05-04T10:00:00Z","type":"run.created","run_id":"r_abc","mode":"autonomous","task":"Fix login bug"}
{"ts":"2026-05-04T10:00:01Z","type":"plan.proposed","run_id":"r_abc","plan":"1. Read auth.ts 2. Fix validation 3. Add test"}
{"ts":"2026-05-04T10:00:02Z","type":"approval.requested","run_id":"r_abc","plan_hash":"sha256:..."}
{"ts":"2026-05-04T10:00:05Z","type":"approval.granted","run_id":"r_abc","approved_by":"user"}
{"ts":"2026-05-04T10:00:06Z","type":"model.turn.started","run_id":"r_abc","model":"glm-5","provider":"zai"}
{"ts":"2026-05-04T10:00:12Z","type":"tool.requested","run_id":"r_abc","tool":"read_file","path":"auth.ts"}
{"ts":"2026-05-04T10:00:12Z","type":"tool.approved","auto":true,"permission_class":"auto_allow"}
{"ts":"2026-05-04T10:00:13Z","type":"tool.executed","tool":"read_file","status":"ok","ms":12}
{"ts":"2026-05-04T10:00:20Z","type":"diff.proposed","run_id":"r_abc","files":["auth.ts"]}
{"ts":"2026-05-04T10:00:25Z","type":"diff.applied","run_id":"r_abc","approved_by":"user"}
{"ts":"2026-05-04T10:00:26Z","type":"run.completed","run_id":"r_abc","status":"completed","artifacts":2}
```

**Стандартные типы событий:** `run.created`, `plan.proposed`, `approval.requested`, `approval.granted`, `model.turn.started/completed`, `tool.requested/approved/executed`, `artifact.created`, `diff.proposed/applied`, `test.completed`, `run.blocked/completed/failed/cancelled`

**Где хранить:** `packages/engine/src/runtime/event-ledger.ts` (новый)

### 4.3 Permission Ladder

Три уровня для каждого tool:

| Уровень | Что можно | Примеры |
|---------|-----------|---------|
| **Auto-allow** | Чтение, поиск, диагностика, метаданные | `read_file`, `search`, `list_dir` |
| **Ask once** per workspace | Запись, тесты, branch, read-only browser | `write_file`, `run_test`, `create_branch` |
| **Ask every time** | Shell с side effects, git push, deploy, secrets | `shell_exec`, `git_push`, `deploy`, `secrets_access` |

**Каждый tool декларирует:** input schema, output schema, side-effect class, timeout, sandbox profile, idempotency, approval requirement, audit rules

**Где хранить:** `packages/engine/src/runtime/permission-engine.ts` (новый)

### 4.4 Artifact Model

Типизированные, адресуемые артефакты:

| Тип | Описание |
|-----|----------|
| `diff` | Proposed change |
| `patch` | Applied patch |
| `log` | Execution log |
| `test_result` | Test run output |
| `screenshot` | Browser/UI capture |
| `plan` | Agent plan |
| `summary` | Run summary |
| `risk_report` | Risk analysis |
| `pm_update` | CEOClaw PM update |
| `release_note` | Release artifact |

**Где хранить:** `packages/engine/src/runtime/artifact-model.ts` (новый)

---

## 5. Implementation Roadmap

### Phase 0: Truth Cleanup & Audit Finalization (27.04 — 03.05, 1 неделя)

**Цель:** Синхронизировать документацию с реальностью. Никаких планов против устаревших предположений.

| Задача | Часы | Файлы |
|--------|------|-------|
| Обновить README.md всех трёх репо с каноническими ролями | 4h | `README.md` × 3 |
| Создать machine-readable capability inventory | 4h | `docs/capability-inventory.json` (новый) |
| Замаркировать archived код (`_archive/`) как archived | 2h | `packages/engine/src/runtime/_archive/*` |
| Синхронизировать docs: routes, tests, storage | 4h | `docs/` в pyrfor-dev и ceoclaw-dev |
| Определить статус каждого компонента: production/beta/prototype/archived | 2h | `docs/capability-inventory.json` |
| Align test naming и coverage expectations | 2h | Тесты engine |

**Milestone P0:**
- ✅ Любой contributor может ответить: какой repo владеет какой capability
- ✅ Docs и code capability inventory консистентны
- ✅ Нет "missing" features которые уже реализованы

**Acceptance:** Review с Сашей, что inventory корректен.

---

### Sprint 1: Foundation (04.05 — 17.05, 2 недели)

**Фокус:** Canonical contracts + MCP интеграция + VSCode scaffold

| # | Задача | Часы | Файлы | Зависимость |
|---|--------|------|-------|-------------|
| 1 | Run Lifecycle state machine | 12h | `packages/engine/src/runtime/run-lifecycle.ts` (новый) | P0 done |
| 2 | Event Ledger (JSONL writer+reader) | 16h | `packages/engine/src/runtime/event-ledger.ts` (новый) | — |
| 3 | Permission Engine (ladder + tool registry) | 12h | `packages/engine/src/runtime/permission-engine.ts` (новый) | — |
| 4 | Artifact Model | 8h | `packages/engine/src/runtime/artifact-model.ts` (новый) | — |
| 5 | MCP → Tool Engine adapter | 12h | `packages/engine/src/tools/mcp-tool-adapter.ts` (новый) | — |
| 6 | FTS5 Search API (публичный) | 8h | `packages/engine/src/memory/fts5-search.ts` (новый) | — |
| 7 | VSCode Extension scaffold | 8h | `vscode-extension/` (новый каталог) | — |
| 8 | VSCode: WebSocket client к daemon | 12h | `vscode-extension/src/daemon-client.ts` | #7 |
| 9 | VSCode: Chat panel UI | 12h | `vscode-extension/src/panels/chat.ts` | #8 |
| 10 | Provider Router: выделить в standalone модуль | 8h | `packages/engine/src/ai/provider-service.ts` (новый) | — |
| 11 | Тесты на всё новое | 12h | `__tests__/*.test.ts` | #1-6 |
| **Итого** | | **112h** | | |

**Milestone S1:**
- ✅ Run lifecycle работает: draft → planned → running → completed
- ✅ Event ledger пишет JSONL, читает и фильтрует
- ✅ Permission engine проверяет tools по ladder
- ✅ VSCode extension подключается к daemon, показывает chat

---

### Sprint 2: VSCode Features + FreeClaude Mode (18.05 — 31.05, 2 недели)

**Фокус:** Полноценный VSCode Extension + FreeClaude интеграция в IDE

| # | Задача | Часы | Файлы | Зависимость |
|---|--------|------|-------|-------------|
| 1 | VSCode: File sync (two-way) | 12h | `vscode-extension/src/file-sync.ts` | S1#8 |
| 2 | VSCode: Mode switcher (Pyrfor ↔ FreeClaude) | 8h | `vscode-extension/src/mode-switcher.ts` | S1#9 |
| 3 | VSCode: Inline suggestions (ghost text) | 16h | `vscode-extension/src/inline.ts` | S1#9 |
| 4 | VSCode: Diff preview (side-by-side) | 12h | `vscode-extension/src/diff-view.ts` | S1#9 |
| 5 | VSCode: Task panel (running tasks) | 8h | `vscode-extension/src/panels/tasks.ts` | S1#8 |
| 6 | FreeClaude Mode: core integration | 16h | `packages/engine/src/runtime/freeclaude-mode.ts` (новый) | S1#1 |
| 7 | FreeClaude: slash commands (/commit, /diff, /plan) | 8h | `packages/engine/src/runtime/slash-commands.ts` (новый) | #6 |
| 8 | FreeClaude: memory bridge (FS ↔ SQLite) | 8h | `packages/engine/src/memory/memory-bridge.ts` (новый) | #6 |
| 9 | FreeClaude: provider router порт в engine | 8h | Из `freeclaude-dev/src/services/api/fallbackChain.ts` → engine | S1#10 |
| 10 | FreeClaude: task manager адаптация | 8h | Из `freeclaude-dev/src/services/memory/*.ts` → engine | #8 |
| 11 | Тесты на всё новое | 12h | `__tests__/*.test.ts` | #1-10 |
| **Итого** | | **116h** | | |

**Milestone S2:**
- ✅ VSCode extension: chat + file sync + diff preview + task panel
- ✅ FreeClaude mode работает в IDE
- ✅ Slash commands работают (/commit, /diff, /plan)
- ✅ Shared memory между Pyrfor и FreeClaude режимами

---

### Sprint 3: Integration + CEOClaw Bridge (01.06 — 14.06, 2 недели)

**Фокус:** Замкнуть loop Pyrfor ↔ CEOClaw + A2A polish + hardening

| # | Задача | Часы | Файлы | Зависимость |
|---|--------|------|-------|-------------|
| 1 | CEOClaw Integration API (Pyrfor side) | 12h | `packages/engine/src/integrations/ceoclaw-client.ts` (новый) | S2 |
| 2 | CEOClaw: Pyrfor webhook ingestion | 8h | `ceoclaw-dev/app/api/integrations/pyrfor/route.ts` (новый) | — |
| 3 | CEOClaw: task sync (bidirectional) | 12h | Обе стороны | #1, #2 |
| 4 | CEOClaw: goals → Pyrfor agents delegation | 8h | CEOClaw goal → Pyrfor run | #3 |
| 5 | A2A polish: Agent Card + discovery | 8h | Доработка `a2a-client.ts` | — |
| 6 | A2A: Task protocol (send/receive) | 8h | Доработка `pyrfor-a2a-fc.ts` | #5 |
| 7 | Run events → CEOClaw heartbeat feed | 8h | Event ledger → CEOClaw API | #1 |
| 8 | Session persistence (save/restore) | 8h | `packages/engine/src/runtime/session-store.ts` (новый) | S1#1 |
| 9 | Performance optimization | 8h | Startup, memory, caching | — |
| 10 | Тесты integration | 12h | E2E + unit | #1-8 |
| **Итого** | | **92h** | | |

**Milestone S3:**
- ✅ CEOClaw goal может стать Pyrfor run
- ✅ Pyrfor run events обновляют CEOClaw PM state
- ✅ A2A discovery + task exchange работает
- ✅ Bidirectional task sync стабильный

---

### Sprint 4: Quality + Release Preparation (15.06 — 28.06, 2 недели)

**Фокус:** Eval suites, security hardening, packaging, documentation

| # | Задача | Часы | Файлы | Зависимость |
|---|--------|------|-------|-------------|
| 1 | Eval Suite Layer 1: Tool determinism | 12h | `packages/engine/src/evals/tool-determinism.ts` (новый) | S1-S3 |
| 2 | Eval Suite Layer 2: Agent task evals | 8h | `packages/engine/src/evals/agent-evals.ts` (новый) | #1 |
| 3 | Eval Suite Layer 3: Safety evals | 8h | `packages/engine/src/evals/safety-evals.ts` (новый) | #1 |
| 4 | Security audit: permission enforcement | 8h | Проверка всех tool calls | S1#3 |
| 5 | Security: OS keychain integration | 4h | Secrets storage | — |
| 6 | Signed Tauri builds + auto-update | 8h | `apps/pyrfor-ide/src-tauri/` конфигурация | — |
| 7 | VSCode Marketplace packaging | 4h | `vscode-extension/package.json`, icons | S2 |
| 8 | Documentation: user guide | 8h | `docs/user-guide.md` (новый) | — |
| 9 | Documentation: architecture + contracts | 8h | `docs/architecture.md` (новый) | — |
| 10 | Documentation: MCP integration guide | 4h | `docs/mcp-guide.md` (новый) | — |
| 11 | E2E bug fixes + stabilization | 12h | По результатам testing | #1-3 |
| **Итого** | | **84h** | | |

**Milestone S4:**
- ✅ Golden trace evals в CI
- ✅ Safety evals покрывают: prompt injection, secret exfiltration, destructive commands
- ✅ Tauri signed builds
- ✅ VSCode extension готов к marketplace

---

### Sprint 5: CEOClaw Vertical + Release (29.06 — 12.07, 2 недели)

**Фокус:** CEOClaw Telegram Bot + Evidence Ledger + Pyrfor v1.0 release

| # | Задача | Часы | Файлы | Зависимость |
|---|--------|------|-------|-------------|
| 1 | CEOClaw Telegram Bot: notifications | 12h | `ceoclaw-dev/lib/telegram/bot.ts` (новый) | — |
| 2 | CEOClaw Telegram Bot: commands (/status, /tasks) | 8h | `ceoclaw-dev/lib/telegram/commands.ts` (новый) | #1 |
| 3 | CEOClaw Evidence Ledger | 12h | `ceoclaw-dev/lib/evidence/ledger.ts` (новый) | S3#7 |
| 4 | CEOClaw: explainable alerts | 8h | Source + assumptions + impact + recommendation | #3 |
| 5 | Pyrfor IDE v1.0 final polish | 12h | UI polish, onboarding flow | S4 |
| 6 | Pyrfor IDE v1.0 release | 4h | Release notes, tag, deploy | #5 |
| 7 | VSCode Extension publish | 4h | Marketplace submission | S4#7 |
| 8 | CEOClaw v1.1 release (integration) | 4h | Tag + release notes | #1-4 |
| **Итого** | | **64h** | | |

**Milestone S5:**
- ✅ Pyrfor IDE v1.0 released
- ✅ VSCode Extension в marketplace
- ✅ CEOClaw v1.1 с Telegram bot + Evidence Ledger
- ✅ Pyrfor ↔ CEOClaw integration live

---

### Sprint 6: Growth + Advanced Features (13.07 — 26.07, 2 недели)

**Фокус:** Browser validation, specialist subagents, observability

| # | Задача | Часы | Файлы |
|---|--------|------|-------|
| 1 | Browser validation через MCP (Playwright) | 16h | `packages/engine/src/tools/browser-mcp.ts` (новый) |
| 2 | Specialist subagent: repo mapper | 8h | `packages/engine/src/subagents/repo-mapper.ts` (новый) |
| 3 | Specialist subagent: test/fix agent | 8h | `packages/engine/src/subagents/test-fixer.ts` (новый) |
| 4 | Specialist subagent: security reviewer | 8h | `packages/engine/src/subagents/security-reviewer.ts` (новый) |
| 5 | Specialist subagent: PM summarizer | 8h | `packages/engine/src/subagents/pm-summarizer.ts` (новый) |
| 6 | OpenTelemetry local observability | 12h | `packages/engine/src/observability/otel.ts` (новый) |
| 7 | Product analytics (privacy-preserving) | 8h | `packages/engine/src/observability/analytics.ts` (новый) |
| 8 | Тесты + evals на новое | 12h | — |
| **Итого** | | **80h** | |

**Milestone S6:**
- ✅ Browser validation через MCP
- ✅ 4 specialist subagents работают
- ✅ OTel observability для debugging
- ✅ Privacy-preserving analytics

---

## 6. Summary Timeline & Hours

| Фаза | Период | Фокус | Часы |
|------|--------|-------|------|
| **P0** | 27.04 — 03.05 | Truth Cleanup | ~16h |
| **S1** | 04.05 — 17.05 | Contracts + VSCode scaffold | ~112h |
| **S2** | 18.05 — 31.05 | VSCode + FreeClaude Mode | ~116h |
| **S3** | 01.06 — 14.06 | CEOClaw Integration + A2A | ~92h |
| **S4** | 15.06 — 28.06 | Quality + Evals + Docs | ~84h |
| **S5** | 29.06 — 12.07 | Release + CEOClaw Vertical | ~64h |
| **S6** | 13.07 — 26.07 | Advanced Features | ~80h |
| **ИТОГО** | **14 недель** | | **~564h** |

**Из них новая работа:** ~564ч  
**Уже готово (НЕ включено):** ~236ч (subagents, MCP, A2A, memory, providers, heartbeat pages)  
**Полная стоимость без готового:** ~800ч

---

## 7. Key Risks & Mitigation

| Риск | Impact | Вероятность | Митигация |
|------|--------|-------------|-----------|
| VSCode Extension API сложнее ожидаемого | High | Medium | Feature flags, MVP без ghost text → добавить в S2 |
| Duplicate orchestration cores | High | Low | P0: canonical ownership, freeze duplicates |
| Truth drift между docs и code | High | Medium | P0: capability inventory + sync gates |
| Subagent merge conflicts | High | Medium | Typed jobs, isolated worktrees, one merge path |
| Opaque provider costs | High | Low | Budget profiles, cost badges, spend caps (S1-S2) |
| Security: tools/shell side effects | High | Medium | Permission ladder (S1), safety evals (S4) |
| CEOClaw becomes generic PM | High | Low | Focus vertical: evidence, budget, schedule, risk, 1C |
| A2A distraction | Medium | Low | Internal: typed jobs. A2A: external federation only |
| Overbuilding IDE features | High | Medium | Thin shells, strong runtime. Not Cursor clone. |
| FreeClaude integration complexity | Medium | Medium | Пошаговый порт: router → fallback → memory → task |

---

## 8. Success Metrics

### Technical

- ✅ Runs replayable from event logs
- ✅ Side-effecting tool calls are policy-checked
- ✅ Autonomous edits in isolated branches/worktrees
- ✅ FTS5 search retrieves exact symbols + semantic context
- ✅ Provider route, cost, fallback visible for every run
- ✅ Golden trace evals in CI (tool determinism + safety)
- ✅ Pyrfor IDE cold start < 2s
- ✅ 300+ новых тестов на контракты и интеграцию

### Product

- ✅ Developer: idea → diff → accepted change внутри Pyrfor
- ✅ PM: task status + heartbeat + artifacts + evidence в CEOClaw
- ✅ User trust: inspect, undo, replay any action
- ✅ Local-first mode works without cloud lock-in
- ✅ VSCode Extension published in marketplace
- ✅ CEOClaw Telegram Bot отправляет уведомления

### Business Positioning

- ✅ FreeClaude: credible open/local-first autonomous coding executor
- ✅ Pyrfor: credible agent runtime/control plane (not Cursor clone)
- ✅ CEOClaw: credible vertical construction/operations AI PMO

---

## 9. Explicitly Deferred

| Функция | Причина | Когда |
|---------|---------|-------|
| FreeClaude Desktop (Tauri) | CLI + VSCode достаточно | Q4 2026 |
| Full A2A internal subagent protocol | Typed jobs проще и детерминированнее | Q3 2026 |
| Public skills marketplace | Сначала validate internally | Q4 2026 |
| Real-time collaborative editing | Сложно, мало users | 2027 |
| Mobile app primary surface | Out of scope | 2027 |
| Enterprise RBAC/SSO/SCIM | Architecture ready, implementation later | Q4 2026 |
| On-prem enterprise packaging | Need PM proof first | 2027 |

---

## 10. Implementation Notes

1. **Не начинать с переписывания UI.** Начать с контрактов и runtime truth (P0-S1).
2. **Не дублировать FreeClaude logic внутри Pyrfor.** Вызывать engine service.
3. **Не превращать CEOClaw в generic IDE.** Это PM/Ops vertical.
4. **Не делать A2A блокером для subagents.** Typed jobs internally, A2A externally.
5. **Autonomy ≠ bypass.** Agent не обходит review, permissions, audit.
6. **Prefer fewer, reliable flows** over many impressive but fragile demos.
7. **Build → test → commit** after every file change, не накапливать ошибки.
8. **Контракты (run lifecycle, event ledger, permission ladder)** — shared truth для всего стека.

---

## 11. Release Plan

| Релиз | Дата | Что включает |
|-------|------|-------------|
| **Pyrfor v0.3.0** | 17.05 | Contracts + MCP integration + VSCode scaffold |
| **Pyrfor v0.4.0** | 31.05 | VSCode feature-complete + FreeClaude mode |
| **Pyrfor v0.5.0** | 14.06 | CEOClaw integration + A2A |
| **Pyrfor v0.9.0-beta** | 28.06 | Evals + security + signed builds |
| **Pyrfor v1.0.0** | 12.07 | Production release + VSCode marketplace |
| **CEOClaw v1.1.0** | 12.07 | Telegram Bot + Evidence Ledger + Pyrfor integration |
| **Pyrfor v1.1.0** | 26.07 | Browser validation + specialist subagents + OTel |

---

## 12. Key Files Map

### Pyrfor — Already Working (DO NOT REWRITE)

```
packages/engine/src/runtime/subagents.ts              ✅ 390 строк, 72 теста
packages/engine/src/runtime/mcp-server.ts             ✅ 146 строк, 11 тестов
packages/engine/src/runtime/mcp-client.ts             ✅ 386 строк, 25 тестов
packages/engine/src/runtime/pyrfor-mcp-server-fc.ts   ✅ FreeClaude MCP
packages/engine/src/runtime/a2a-client.ts             ✅ 321 строка
packages/engine/src/runtime/pyrfor-a2a-fc.ts          ✅ 195 строк
packages/engine/src/runtime/memory-store.ts           ✅ 509 строк, FTS5 + BM25
packages/engine/src/memory/prisma-memory-manager.ts   ✅ 461 строка
packages/engine/src/runtime/llm-provider-router.ts    ✅ Provider routing
packages/engine/src/runtime/pyrfor-fc-circuit-router.ts ✅ Circuit breaker
packages/engine/src/runtime/multimodal-router.ts      ✅ Multimodal
packages/engine/src/runtime/config.ts                 ✅ Hot-reload via fs.watch
daemon/gateway.ts                                     ✅ HTTP + WebSocket
daemon/telegram/voice.ts                              ✅ Whisper API
packages/engine/src/ai/providers/                     ✅ Ollama + MLX
apps/pyrfor-ide/src-tauri/                            ✅ Tauri IDE v0.2.0
```

### Pyrfor — To Create

```
packages/engine/src/runtime/run-lifecycle.ts           📝 S1 — State machine
packages/engine/src/runtime/event-ledger.ts            📝 S1 — JSONL append-only
packages/engine/src/runtime/permission-engine.ts       📝 S1 — Permission ladder
packages/engine/src/runtime/artifact-model.ts          📝 S1 — Typed artifacts
packages/engine/src/tools/mcp-tool-adapter.ts          📝 S1 — MCP → Tool Engine
packages/engine/src/memory/fts5-search.ts              📝 S1 — Search API
packages/engine/src/runtime/freeclaude-mode.ts         📝 S2 — FC mode core
packages/engine/src/runtime/slash-commands.ts          📝 S2 — /commit, /diff, /plan
packages/engine/src/memory/memory-bridge.ts            📝 S2 — FS ↔ SQLite
packages/engine/src/integrations/ceoclaw-client.ts     📝 S3 — CEOClaw API client
packages/engine/src/runtime/session-store.ts           📝 S3 — Session persistence
packages/engine/src/evals/tool-determinism.ts          📝 S4 — Eval suite
packages/engine/src/evals/agent-evals.ts               📝 S4 — Eval suite
packages/engine/src/evals/safety-evals.ts              📝 S4 — Eval suite
packages/engine/src/tools/browser-mcp.ts               📝 S6 — Playwright MCP
packages/engine/src/subagents/repo-mapper.ts           📝 S6 — Specialist
packages/engine/src/subagents/test-fixer.ts            📝 S6 — Specialist
packages/engine/src/subagents/security-reviewer.ts     📝 S6 — Specialist
packages/engine/src/subagents/pm-summarizer.ts         📝 S6 — Specialist
packages/engine/src/observability/otel.ts              📝 S6 — OTel
vscode-extension/                                      📝 S1-S2 — Full extension
```

### CEOClaw — To Create/Modify

```
app/api/integrations/pyrfor/route.ts                  📝 S3 — Pyrfor webhook
app/api/integrations/pyrfor/events/route.ts           📝 S3 — Event ingestion
lib/evidence/ledger.ts                                 📝 S5 — Evidence ledger
lib/telegram/bot.ts                                    📝 S5 — Telegram bot
lib/telegram/commands.ts                               📝 S5 — Bot commands
```

### FreeClaude — To Port

```
freeclaude-dev/src/services/api/fallbackChain.ts  → packages/engine/src/ai/fallback-chain.ts
freeclaude-dev/src/services/memory/*.ts            → packages/engine/src/memory/fc-memory.ts
freeclaude-dev/src/services/api/openaiShim.ts      → packages/engine/src/ai/openai-shim.ts
freeclaude-dev/extension/src/extension.ts          → vscode-extension/src/fc-integration.ts
```

---

*План финализирован: 27.04.2026*  
*Объединяет лучшее из Copilot (контракты, evals, security, positioning) и FreeClaude (реальные файлы, оценки, спринты)*  
*Учитывает проверенное состояние: Pyrfor v0.2.0, CEOClaw v1.0.0, A2A уже работает*
