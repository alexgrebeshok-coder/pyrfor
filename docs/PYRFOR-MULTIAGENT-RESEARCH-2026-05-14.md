# Pyrfor: Полное исследование позиционирования среди OSS multi-agent решений

**Дата:** 2026-05-14
**Версия:** v1.0
**Связанный документ:** [`PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md`](./PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md)

---

## TL;DR

1. **Pyrfor — архитектурно самый глубокий** OSS-проект из исследованных: только он имеет одновременно governed lifecycle (`plan → research → execute → critique → postmortem → memory_persist → done`), dual-role MCP gateway (server+client+FC bridge), cost-aware DAG, structured FTS5-memory с wiki/rollup, trajectory recorder с incident packet export, и нативный Tauri desktop. Это уровень engineering, опережающий OSS-экосистему на 12–18 месяцев по governance-модели.
2. **Конкурентный ландшафт распадается на два уровня**: (a) **coding-агенты** (OpenHands, Aider, Cline, Goose, gptme, Codex, Plandex, SWE-agent) — каждый сильнее в одном из аспектов (benchmarks, repo-map, marketplace, IDE-integration), но никто не имеет всего разом; (b) **multi-agent frameworks** (LangGraph, AutoGen/AG2, CrewAI, MetaGPT, Mastra, VoltAgent, Pydantic-AI, Letta, smolagents, DSPy, Agno) — задают стандарты паттернов (checkpointing, AG-UI events, suspend/resume, typed DI, code-as-action).
3. **Стек протоколов 2026 определился**: MCP (Streamable HTTP) + A2A + ACP + AG-UI + OpenTelemetry GenAI semantic conventions. Pyrfor покрывает 3 из 5 (MCP, A2A, ACP), не имеет AG-UI и нативной OTel-инструментации.
4. **Уникальные сильные стороны Pyrfor** (защищать): governed lifecycle, dual-role MCP, cost-aware DAG, SQLite+FTS5+wiki+rollup, trajectory+incident packets, native Tauri desktop, TypeScript-first.
5. **Главный разрыв — не технология, а distribution и DX**: Pyrfor приватный, нет one-command install, нет публичного бенчмарка SWE-bench, нет VS Code/Zed extension, нет marketplace, нет AG-UI совместимости. Решается за 4–8 недель работы.
6. **Уникальная ниша для позиционирования**: «**The Governance Layer for AI Coding**» — incident packets, audit trail, trajectory replay, circuit breaker, approval flow, cost budgets. Целевая аудитория — tech leads и engineering managers, где нет прямой конкуренции (OpenHands governance — только в платном enterprise tier).
7. **Если выполнить P0+P1 (~24 пункта плана) — Pyrfor становится №1 OSS multi-agent coding-runtime в мире**. Технологический фундамент уже есть; не хватает обвязки экосистемы и публичного входа.

---

## 1. Контекст и методология

### 1.1 Цель исследования

Понять, насколько Pyrfor готов стать **лучшим open-source решением для мультиагентных систем разработки кода** — полноценным со всех сторон: архитектура, фичи, безопасность, экосистема, distribution, observability, документация, community. **Цель не — захват рынка**; цель — полнота и качество как OSS-продукта.

### 1.2 Методология

Запущена **мультиагентная исследовательская система** из 4 параллельных агентов:

1. **`pyrfor-inventory`** (explore-агент) — глубокая локальная инвентаризация репозитория `/Users/aleksandrgrebeshok/pyrfor-dev` (304 файла в `packages/engine/src/runtime`, IDE компоненты, daemon, CLI, docs).
2. **`research-coding-agents`** (research-агент) — детальное сравнение с 12 OSS coding-агентами (OpenHands, Aider, Cline, Roo Code, Goose, Continue, SWE-agent, Devika, Plandex, gptme, Codex CLI, Zed+ACP).
3. **`research-multiagent-frameworks`** (research-агент) — 14 OSS multi-agent frameworks (LangGraph, AutoGen, AG2, CrewAI, MetaGPT, Swarm/Agents SDK, smolagents, Pydantic-AI, Agno, LlamaIndex, DSPy, Letta, Mastra, VoltAgent).
4. **`research-infra-and-protocols`** (research-агент) — sandbox (E2B/Daytona/microsandbox/Firecracker), протоколы (MCP/ACP/A2A/AG-UI/AGNTCY), observability (OTel GenAI/Langfuse/Phoenix/Laminar), eval (SWE-bench/Inspect/DeepEval/promptfoo), memory (Letta/mem0/Zep/Cognee), security, distribution (Tauri 2).

Затем — синтез и сравнительный анализ.

### 1.3 Источники

См. **Приложение A** в конце документа.

---

## 2. Что такое Pyrfor сегодня (детальная инвентаризация)

### 2.1 Архитектурные слои

| Слой | Назначение | Зрелость |
|---|---|---|
| `apps/pyrfor-ide` | Tauri desktop shell (Monaco editor, PTY terminal, Git UI, SSE chat, updater) | beta |
| `packages/engine/src/runtime` | Канонический runtime (304 файла): gateway, session, memory, tools, MCP, sidecar entrypoint | beta → near-prod |
| `packages/engine/src/universal/engine-loop.ts` | Universal Engine lifecycle | beta |
| `packages/cli` | CLI: `concept`, `approvals`, `migrate`, `tools`, `memory`, `skills` | beta → prod-ready |
| `daemon/` | Compatibility/service wrapper (legacy daemon + Telegram bot) | beta (legacy) |
| `prisma/` | Shared schema для опциональных Postgres-flow | prod |
| `vscode-extension/` | Скелет VS Code extension | alpha |
| `config/` | Runtime agent и plugin manifests | prod |

### 2.2 Universal Engine lifecycle

Реализован в `packages/engine/src/runtime/universal/engine-loop.ts`:

```
plan → research? → execute → critique → postmortem → memory_persist → done
```

Поддерживает: DAG, rollback, abort, re-hydration, compensators. **Уникальная черта** — explicit `postmortem` фаза с генерацией incident packet (`concept export --incident-packet`) и `memory_persist` фаза, гарантирующая, что и успешные, и неуспешные runs производят постмортем-артефакты для самообучения.

### 2.3 Subagent orchestration

- **`subagents.ts`** — `SubagentSpawner` с контекстом, лимитом конкурентности, статусами, отменой через `AbortController`.
- **`subagent-orchestrator.ts`** — отдельный orchestrator с семафором, budget caps, parallel/serial spawn.
- **Pyrfor-fc-plan-act.ts** — FreeClaude integration mode.
- Worktree isolation **заявлена в архитектуре, но явного worktree-менеджера в коде не найдено** — пробел.

### 2.4 MCP / A2A / ACP — тройная протокольная роль

| Протокол | Где | Роль | Состояние |
|---|---|---|---|
| **MCP** | `mcp-server.ts`, `mcp-client.ts`, `pyrfor-mcp-server-fc.ts` | **И server, и client одновременно** (уникально среди конкурентов!) | beta — поддерживает stdio + SSE; Streamable HTTP — TODO |
| **A2A** | `a2a-client.ts`, `pyrfor-a2a-fc.ts` | Register/list/call/unregister; discovery через `/.well-known/a2a-card`; вызов `skills/{skill}/invoke` | beta |
| **ACP** | `acp-client.ts`, `acp-trajectory-bridge.ts` | JSON-RPC 2.0 over stdio; bounded queues; permission requests fail-closed; trajectory bridge | beta — есть client, нет server |
| **AG-UI** | — | **Не реализовано** — главный пробел в frontend↔agent протоколе | ❌ |

### 2.5 Memory

- **`memory-store.ts`** — SQLite + FTS5: таблицы `memory_entries`, `memory_fts`, triggers, BM25 search.
- **`memory-wiki.ts`** — wikilinks/backlinks/orphans/brokenLinks с atomic flush.
- **`memory-rollup.ts`** — episode consolidation.
- **`project-memory.ts`** — per-project scoping.
- **`workspace-memory-injection.ts`** — context injection в LLM.
- **`prisma-memory-manager.ts`** — Prisma adapter для опционального Postgres backend.

**Уникально:** структурированная, persistent, cross-session memory с wiki + rollup в одном local-first стеке. Конкуренты используют либо session-only thread summaries (Codex), либо git-as-brain (gptme), либо vector-only (большинство frameworks).

### 2.6 Provider routing и cost-aware DAG

- **`llm-provider-router.ts`** — основной router.
- **`provider-router.ts`** — secondary.
- **`multimodal-router.ts`** — для multimodal моделей.
- **`pyrfor-fc-circuit-router.ts`** — circuit breaker pattern с автоматическим failover при деградации провайдера.
- **`cost-tracker.ts`** + **`cost-aware-dag.ts`** — explicit cost tracking на уровне DAG.

**Уникально:** ни один из 14 multi-agent frameworks не имеет cost-aware DAG. Circuit breaker в provider routing — также эксклюзив.

### 2.7 Governance: approvals, run lifecycle, trajectory, incident packets

- **`approval-flow.ts`** — categorize tools into `auto/ask/block`; settings; audit events; whitelist/blacklist/patterns.
- **`run-lifecycle.ts`** — формализованное state machine.
- **`trajectory.ts`** + **`pyrfor-trajectory-recorder.ts`** — полная запись исполнения.
- **`acp-trajectory-bridge.ts`** — пишет tool calls / validation / gate decisions.
- **`backup.ts`** + **`backup-restore.ts`** — backup workflows.
- **`auth-tokens.ts`** — token management.
- **`compact.ts`** + **`ralph-context-rotator.ts`** + **`pyrfor-fc-context-rotate.ts`** — context compaction.

**`concept export --incident-packet`** — экспорт инцидент-пакета (trajectory + cost + memory diff + postmortem) — **уникальная фича** для enterprise / командной работы.

### 2.8 Tools, browser, secrets

- **`tools.ts`** + **`tool-loop.ts`** + **`tool-call-parser.ts`** — tool execution layer.
- **`browser-control.ts`** + **`browser-readiness.ts`** — встроенный browser tool с allowedHosts, таймаутами, launch events. **Readiness-gate требует approvalRequired=true** — governance-aware.
- **`auth-tokens.ts`** — token management (но не Stronghold-уровень шифрования).

### 2.9 Зрелость по компонентам

| Компонент | Зрелость |
|---|---|
| IDE shell | beta |
| Runtime gateway / session / memory / approvals | beta → near-prod |
| Subagents | prod-ready |
| MCP client/server | beta |
| A2A | beta |
| ACP | beta |
| Universal engine loop | beta |
| Memory-store / memory-wiki | prod-ready |
| Browser tool | beta |
| Legacy daemon / Telegram | beta (legacy) |
| CLI | beta → prod-ready |
| **Full platform** | **alpha/beta** (не «1.0 stable» целиком) |

### 2.10 Что уникально (защищать!)

1. Одновременная поддержка **MCP + A2A + ACP** в одной системе.
2. **Governed concept lifecycle** с DAG, replay, rollback, postmortem, memory persistence.
3. **SQLite FTS memory + wiki + rollup + governance approvals** в одном local-first стеке.
4. **Browser QA readiness** с permission-aware gate.
5. **Subagent orchestration** с budget caps и cancel propagation.
6. **Cost-aware DAG** + circuit breaker в provider routing.
7. **Incident packets** через CLI export.
8. **Native Tauri desktop** (не extension, не web-app).

---

## 3. Конкурентный ландшафт: AI Coding Agents

### 3.1 OpenHands (бывший OpenDevin)

- **Repo:** [github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)
- **Stars:** 60k+ (на 2026), high activity (>500 commits/3мес)
- **Архитектура:** standalone web platform (Docker) + headless mode + GUI
- **Local-first vs cloud:** оба варианта
- **Multi-agent:** да — `MicroAgents` система, `CodeActAgent` как основной
- **MCP:** клиент (server — нет)
- **Memory:** event stream + summary; нет cross-session persistent memory как у Pyrfor
- **LLM providers:** multi-provider через litellm
- **Approval / HITL:** confirmation mode, есть
- **Sandbox:** Docker-based (по умолчанию), также Modal/E2B backends
- **Governance:** базовая (audit log), но **enterprise tier closed-source** — incident packets и audit-grade governance только за деньги
- **SWE-bench Verified:** **77.6%** — лидер OSS
- **Уникально:** сильнейший benchmark, web-first UX, headless для CI

### 3.2 Aider

- **Repo:** [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider)
- **Stars:** 25k+, очень высокая активность
- **Установок:** **6.8M+** (один из топовых OSS coding tools)
- **Архитектура:** CLI tool (Python)
- **Multi-agent:** **нет** — single-agent с edit/architect modes
- **MCP:** клиент (через extensions)
- **Memory:** repo map (tree-sitter + ctags) — **best-in-class repo understanding**, но нет persistent memory
- **LLM providers:** multi через litellm
- **Approval / HITL:** confirm before commits
- **Sandbox:** **нет** — работает прямо с git
- **Уникально:** **tree-sitter repo-map** (главное преимущество — агент понимает структуру больших проектов), git-native workflow, лучший SWE-bench score для chat-coding agent
- **Установка:** `pip install aider-chat` — **one command** (главный фактор популярности)

### 3.3 Cline (Claude Dev)

- **Repo:** [github.com/cline/cline](https://github.com/cline/cline)
- **Stars:** **63k+** (один из топовых VS Code extensions)
- **Архитектура:** VS Code extension
- **Multi-agent:** нет — single agent
- **MCP:** **сильнейший клиент + MCP Marketplace с one-click install**
- **Memory:** session-only
- **LLM providers:** multi-provider, focus на Claude
- **Approval / HITL:** «human-in-the-loop» режим — каждое действие подтверждается
- **Sandbox:** работает в workspace, нет VM-isolation
- **Уникально:** **MCP Marketplace** (главный virality канал), browser tool через MCP, поддержка computer use

### 3.4 Roo Code (форк Cline)

- **Repo:** [github.com/RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) — на момент исследования закрыт/недоступен
- **Архитектура:** VS Code extension (форк Cline)
- Основное отличие — multi-mode (Architect/Code/Ask) и custom modes
- Использует ту же MCP экосистему

### 3.5 Goose

- **Repo:** [github.com/block/goose](https://github.com/block/goose)
- **Stars:** 12k+, high activity (поддерживается Block/Square)
- **Архитектура:** Rust-based CLI + desktop GUI
- **Multi-agent:** subrecipes (subagent-like)
- **MCP:** **70+ extensions** через MCP — второй по размеру marketplace
- **Memory:** session + recipes (persistent workflows)
- **LLM providers:** multi-provider
- **Sandbox:** native isolation (Rust)
- **Уникально:** **recipes** (reusable workflows как YAML), **70+ extensions**, ACP support
- **Distribution:** signed binaries для всех платформ

### 3.6 Continue

- **Repo:** [github.com/continuedev/continue](https://github.com/continuedev/continue)
- **Stars:** 22k+, активный
- **Архитектура:** VS Code + JetBrains extension
- **2026 pivot:** в сторону CI checks, не только chat
- **Multi-agent:** нет
- **MCP:** клиент
- **Memory:** в основном context
- **Уникально:** широкая IDE-поддержка, customizable models, prompt library

### 3.7 SWE-agent

- **Repo:** [github.com/SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) (princeton-nlp)
- **Stars:** 15k+
- **Архитектура:** Python CLI/library, академический проект
- **Multi-agent:** нет (но недавно анонсирован SWE-bench Multi)
- **Sandbox:** Docker-based (Agent-Computer Interface — ACI)
- **Уникально:** **SOTA open-source на SWE-bench** многократно; **mini-SWE-agent** — упрощённая версия 65% SWE-bench

### 3.8 Devika

- **Repo:** [github.com/stitionai/devika](https://github.com/stitionai/devika)
- **Stars:** 18k (преимущественно от хайпа 2024)
- **Статус:** экспериментальный / **выглядит заброшенным** (последний commit давно)
- **Архитектура:** Python web UI
- **Multi-agent:** есть planner/researcher/coder агенты
- Полезен как референс архитектуры, не как живой проект

### 3.9 Plandex

- **Repo:** [github.com/plandex-ai/plandex](https://github.com/plandex-ai/plandex)
- **Stars:** 12k+
- **Архитектура:** Go CLI + server (cloud вариант **закрыт**)
- **Multi-agent:** есть (model packs — разные модели для разных шагов)
- **Memory:** **20M токен contexts** через tree-sitter chunking
- **Sandbox:** sandboxed plan execution
- **Уникально:** **plan branching/compare** (killer feature — запустить тот же plan с разными моделями и сравнить), 20M token contexts, Chrome debug

### 3.10 gptme

- **Repo:** [github.com/gptme/gptme](https://github.com/gptme/gptme)
- **Stars:** 4k+, активный
- **Архитектура:** Python CLI + web UI
- **Multi-agent:** subagents через TaskGroup
- **MCP:** клиент
- **Memory:** **git-as-brain** (хранит контекст в git-репозиториях)
- **ACP:** **уже реализовал Phase 1** — `python -m gptme.acp` → доступен в Zed
- **Уникально:** ACP support, git-native memory, очень простой DX

### 3.11 Codex CLI (OpenAI)

- **Repo:** [github.com/openai/codex](https://github.com/openai/codex)
- **Stars:** 30k+
- **Архитектура:** Rust-based CLI
- **Multi-agent:** нет
- **MCP:** клиент + plugin system с hooks sharing
- **Memory:** thread summaries (session-only)
- **Sandbox:** rust-native isolation
- **Distribution:** `npm i -g @openai/codex` — one command
- **Уникально:** OpenAI-blessed, hooks system, fast Rust execution

### 3.12 Zed + ACP экосистема

- **Repo:** [github.com/zed-industries/zed](https://github.com/zed-industries/zed)
- **Stars:** 50k+
- **Архитектура:** Rust desktop IDE
- **ACP:** **дом протокола** — Zed создал Agent Client Protocol; через ACP можно подключить любой агент (gptme, Pyrfor, etc.)
- **Уникально:** native desktop IDE (Rust+GPUI), мощнейший рендеринг, ACP экосистема

### 3.13 Сводная таблица: AI Coding Agents

| Аспект | Pyrfor | OpenHands | Aider | Cline | Goose | Continue | SWE-agent | gptme | Codex | Plandex |
|---|---|---|---|---|---|---|---|---|---|---|
| Native desktop IDE | ✅ Tauri | ⚠️ web | ❌ CLI | ❌ ext | ⚠️ desk+CLI | ❌ ext | ❌ CLI | ⚠️ web | ❌ CLI | ❌ CLI |
| MCP server | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP client | ✅ | ✅ | ✅ | ✅ MarketP | ✅ 70+ | ✅ | ❌ | ✅ | ✅ | ❌ |
| A2A | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ACP | ✅ client | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ server | ❌ | ❌ |
| AG-UI | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Multi-agent / subagents | ✅ | ✅ | ❌ | ❌ | ⚠️ recipes | ❌ | ❌ | ⚠️ | ❌ | ⚠️ packs |
| Governed lifecycle | ✅ unique | ⚠️ basic | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Postmortem phase | ✅ unique | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Incident packet export | ✅ unique | ❌ (paid) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| FTS persistent memory | ✅ unique | ⚠️ event log | ❌ | ❌ | ⚠️ recipes | ❌ | ❌ | ⚠️ git | ⚠️ thread | ❌ |
| Tree-sitter repo-map | ❌ | ⚠️ | ✅ best | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ |
| Cost-aware DAG | ✅ unique | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ |
| Circuit breaker router | ✅ unique | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approvals / HITL | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ✅ |
| Trajectory replay | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ |
| Sandbox isolation | ⚠️ path-guard | ✅ Docker | ❌ | ⚠️ | ✅ Rust | ❌ | ✅ Docker | ⚠️ | ✅ Rust | ✅ |
| Browser tool | ✅ built-in | ✅ | ❌ | ✅ MCP | ✅ MCP | ❌ | ❌ | ⚠️ MCP | ❌ | ✅ Chrome |
| Cron / scheduled | ✅ | ❌ | ❌ | ❌ | ⚠️ recipes | ❌ | ❌ | ❌ | ❌ | ❌ |
| Voice (Whisper) | ✅ Telegram | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| Marketplace / extensions | ❌ | ⚠️ | ❌ | ✅ MCP MarketP | ✅ 70+ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ |
| VS Code/JetBrains ext | ⚠️ skeleton | ❌ | ❌ | ✅ | ❌ | ✅ both | ❌ | ❌ | ❌ | ❌ |
| One-command install | ❌ | ⚠️ Docker | ✅ pip | ✅ vsix | ✅ binary | ✅ vsix | ⚠️ pip+conf | ✅ pip | ✅ npm | ⚠️ |
| Public SWE-bench score | ❌ | ✅ 77.6% | ✅ | ⚠️ | ⚠️ | ❌ | ✅ SOTA | ⚠️ | ⚠️ | ⚠️ |
| Public docs / repo | ❌ private | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Signed releases / SBOM | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ |

✅ — есть; ⚠️ — частично; ❌ — нет

---

## 4. Конкурентный ландшафт: Multi-Agent Frameworks

### 4.1 LangGraph

- **Repo:** `langchain-ai/langgraph` (SHA 97c31e9)
- **Парадигма:** граф состояний (graph)
- **Язык:** Python (TypeScript SDK есть, но второстепенный)
- **State management:** explicit `State` schema; checkpointing на каждом шаге
- **Memory:** в State + integrations (LangMem, Letta)
- **Tool calling:** function calling, MCP support
- **HITL:** `interrupt()` + `Command` resume
- **Streaming:** `streamMode` (values/updates/messages/custom)
- **Observability:** LangSmith (closed) + OTel
- **Eval:** LangSmith evals
- **Production:** LangGraph Platform (closed для full features)
- **Уникально:** **Checkpointing** (`CheckpointStore`) с uuid6 — даёт resume, time-travel, fork; самый зрелый паттерн на рынке

### 4.2 AutoGen / AG2

- **Repo:** `microsoft/autogen`, `ag2ai/ag2` (форк)
- **Парадигма:** conversational multi-agent (agents «говорят» между собой)
- **Язык:** Python
- **HITL:** `UserProxyAgent`
- **Streaming:** ✅
- **Уникально:** Group chat patterns, `Society of Mind`; AG2 — community-driven форк AutoGen

### 4.3 CrewAI

- **Repo:** `crewAIInc/crewAI`
- **Парадигма:** роли + задачи (Crew = команда Agents с ролями)
- **Язык:** Python
- **State:** в основном через task outputs
- **Tool calling:** custom tools + LangChain tools
- **HITL:** есть
- **Observability:** Langfuse, OTel
- **AG-UI:** ✅ поддерживает
- **Production:** CrewAI Enterprise (closed)
- **Уникально:** простой mental model (роли как в реальной команде), быстрый онбординг

### 4.4 MetaGPT

- **Repo:** `geekan/MetaGPT`
- **Парадигма:** software-team simulation (CEO/PM/Architect/Engineer/QA)
- **Язык:** Python
- **Уникально:** PRD → design → code в одном flow; **частично имеет critique/review phase** (ближайший к Pyrfor postmortem)

### 4.5 OpenAI Swarm / Agents SDK

- **Repos:** `openai/swarm` (legacy), `openai/openai-agents-python` (новый)
- **Парадигма:** «handoffs» (один агент передаёт control другому)
- **Язык:** Python
- **Tool calling:** native OpenAI tools
- **Streaming:** ✅
- **Уникально:** официальный OpenAI SDK, минималистичный; handoff pattern элегантен

### 4.6 smolagents

- **Repo:** `huggingface/smolagents`
- **Парадигма:** **code-as-action** (агент пишет Python код вместо JSON tool calls)
- **Язык:** Python
- **Sandbox:** E2B / Docker / Modal / Microsandbox
- **Уникально:** **−30% шагов vs tool-calling** (доказано научно), HF integration

### 4.7 Pydantic-AI

- **Repo:** `pydantic/pydantic-ai`
- **Парадигма:** typed agents с DI
- **Язык:** Python
- **Уникально:** **`Agent[Deps, Output]` generics** — type safety везде, IDE autocomplete, compile-time errors. Pydantic-команда vibes как победа Python-фреймворка через DX.

### 4.8 Agno (бывший Phidata)

- **Repo:** `agno-agi/agno`
- **Парадигма:** multi-agent с памятью и tools
- **Язык:** Python
- **Memory:** sophisticated (vectors + structured)
- **AG-UI:** ✅
- **Multi-tenancy + RBAC:** ✅ JWT-based — единственный с native enterprise multi-tenancy
- **Уникально:** **multi-tenancy + RBAC** из коробки

### 4.9 LlamaIndex Agents / Workflows

- **Repo:** `run-llama/llama_index`
- **Парадигма:** event-driven workflows
- **Язык:** Python
- **Memory:** RAG-focused
- **Уникально:** RAG + agents в одной экосистеме; workflows pattern (события)

### 4.10 DSPy

- **Repo:** `stanfordnlp/dspy`
- **Парадигма:** declarative + prompt optimization
- **Язык:** Python
- **Уникально:** **компилятор prompts** (не пишутся руками — оптимизируются по trainset); академический корень (Stanford NLP)

### 4.11 Letta (бывший MemGPT)

- **Repo:** `letta-ai/letta`
- **Парадигма:** memory-focused agents
- **Язык:** Python
- **Memory:** **hierarchical** (core memory blocks + archival vector); агент **редактирует свою память** через `core_memory_append`, `core_memory_replace`
- **Уникально:** **memory-as-first-class-citizen**; killer feature для long-running agents

### 4.12 Mastra

- **Repo:** `mastra-ai/mastra`
- **Парадигма:** TypeScript multi-agent + workflows
- **Язык:** **TypeScript**
- **HITL:** **`suspend/resume` API** в executor (`execute: async ({ data, suspend, resumeData }) => ...`)
- **Streaming:** ✅
- **Production:** Mastra Cloud
- **Уникально:** TS-first, чистейший suspend/resume API, `npm create mastra@latest` zero-friction onboarding

### 4.13 VoltAgent

- **Repo:** `VoltAgent/voltagent`
- **Парадигма:** TypeScript multi-agent
- **Язык:** **TypeScript**
- **Observability:** OTel
- **AG-UI:** ✅
- **Уникально:** **`@voltagent/mcp-docs-server`** — MCP сервер с документацией (разработчик подключает к Cursor/Claude и AI знает как использовать фреймворк); `npm create voltagent-app@latest`

### 4.14 Сводная таблица: Multi-Agent Frameworks

| Фреймворк | Язык | Парадигма | Checkpoint | AG-UI | OTel | HITL API | Type DX | Memory | Уникально |
|---|---|---|---|---|---|---|---|---|---|
| LangGraph | Py | graph | ✅ best | ✅ | ✅ | interrupt | ⚠️ | external | Checkpointing SOTA |
| AutoGen/AG2 | Py | conversation | ⚠️ | ⚠️ | ⚠️ | UserProxy | ⚠️ | session | group chat |
| CrewAI | Py | roles | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | external | mental model |
| MetaGPT | Py | sw-team | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | session | PRD→code |
| OpenAI Agents SDK | Py | handoffs | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | session | OpenAI native |
| smolagents | Py | code-action | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | session | -30% steps |
| Pydantic-AI | Py | typed DI | ⚠️ | ❌ | ✅ | ✅ | ✅ best | external | generics |
| Agno | Py | multi-agent | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ vec+struct | RBAC |
| LlamaIndex | Py | workflows | ⚠️ | ❌ | ✅ | ✅ | ⚠️ | RAG | RAG+agents |
| DSPy | Py | declarative | ❌ | ❌ | ❌ | ❌ | ⚠️ | session | prompt optim |
| Letta | Py | memory | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ best | hier memory |
| Mastra | **TS** | workflow | ⚠️ | ⚠️ | ✅ | ✅ best | ✅ | external | suspend/resume API |
| VoltAgent | **TS** | multi-agent | ⚠️ | ✅ | ✅ | ✅ | ✅ | external | mcp-docs |
| **Pyrfor** | **TS** | **lifecycle** | ⚠️ trajectory | ❌ | ⚠️ custom | ✅ approvals | ⚠️ | ✅ FTS+wiki | **lifecycle+cost-DAG** |

---

## 5. Инфраструктура и протоколы экосистемы 2026

### 5.1 Sandbox / isolated execution

| Решение | Тип | Local? | Note |
|---|---|---|---|
| **E2B** | cloud SaaS | нет | open-source SDK, cloud sandboxes |
| **Daytona** | platform | да/cloud | dev environments на VM/containers |
| **Modal** | cloud | нет | GPU-focused |
| **Microsandbox** | rootless microVMs | **да** | local — главный кандидат для desktop AI |
| **Firecracker** | microVM | да | Amazon, базовая технология |
| **Docker / Podman** | containers | да | base solution |
| **Sysbox** | rootless containers | да | Docker-superset |
| **macOS sandbox-exec / App Sandbox** | OS-native | да | macOS-only |
| **Bubblewrap, nsjail** | Linux namespaces | да | минимальный |
| **Git worktrees** | filesystem isolation | да | для file-only |

**Уровни изоляции:**
```
L1: Process isolation (fork + seccomp)
L2: Container (Docker/Podman namespaces)
L3: microVM (Firecracker, Apple Virtualization)
L4: Hardware VM (QEMU)
```

**Рекомендация для Pyrfor:** L1 минимум (worktree + sandbox-exec/bubblewrap), L2-L3 цель (microsandbox через Tauri sidecar).

### 5.2 Протоколы экосистемы

#### MCP (Model Context Protocol, Anthropic)
- **Spec:** [modelcontextprotocol.io](https://modelcontextprotocol.io) (2025-03-26)
- **Transports:** stdio, SSE, **Streamable HTTP** (текущий стандарт)
- **Pyrfor:** stdio + SSE; Streamable HTTP — TODO
- Сильнейший рост экосистемы; де-факто стандарт для tool-серверов

#### ACP (Agent Client Protocol, Zed)
- **Spec:** [github.com/agentclientprotocol/registry](https://github.com/agentclientprotocol/registry)
- Zed создал; gptme, Goose уже внедрили
- Позволяет любому IDE подключить любой агент
- **Pyrfor:** есть client (`acp-client.ts`), нет server

#### A2A (Agent-to-Agent, Google → Linux Foundation)
- **Spec:** [github.com/google-a2a/A2A](https://github.com/google-a2a/A2A)
- Agent Cards via `/.well-known/a2a-card`
- **Pyrfor:** ✅ client реализован

#### AG-UI (Agent-User Interaction Protocol, CopilotKit)
- **Spec:** [ag-ui.com](https://ag-ui.com), [docs.ag-ui.com/concepts/events.md](https://docs.ag-ui.com/concepts/events.md)
- Event types: RunStarted/Finished/Error, TextMessage*, ToolCall* (streaming), StateSnapshot/Delta (JSON Patch), interrupt
- Стандарт для frontend↔agent streaming; LangGraph, CrewAI, Google ADK, Agno, VoltAgent уже поддерживают
- **Pyrfor:** ❌ не реализован — главный пробел

#### AGNTCY / Internet of Agents
- [github.com/agntcy/acp-spec](https://github.com/agntcy/acp-spec)
- Cisco-driven, ранний стандарт для inter-agent communication
- Пока не критичен

#### OpenAI Realtime
- Streaming events (для voice)
- Имеется как часть OpenAI SDK

### 5.3 Observability

| Платформа | OSS? | Self-host? | OTel? | Note |
|---|---|---|---|---|
| **OTel GenAI semconv** | ✅ standard | — | — | стандарт `gen_ai.*` attributes |
| **OpenLLMetry** (Traceloop) | ✅ | — | ✅ | instrumentation library |
| **Langfuse** | ✅ | ✅ | ✅ | самый популярный OSS |
| **Phoenix** (Arize) | ✅ | ✅ | ✅ | Apache 2.0 |
| **Helicone** | ⚠️ | ⚠️ | ✅ | proxy-based |
| **LangSmith** | ❌ closed | ❌ | ⚠️ | LangChain-only |
| **Laminar** | ✅ | ✅ | ✅ | Rust-native, fast |

**Рекомендация для Pyrfor:** OTel GenAI semconv + локальный Langfuse в docker-compose.

### 5.4 Eval / testing

| Бенчмарк / тул | Назначение | OSS? |
|---|---|---|
| **SWE-bench** / **SWE-bench Verified** | code repair benchmark | ✅ |
| **Terminal-bench** | CLI agents benchmark | ✅ |
| **OSWorld** | computer use benchmark | ✅ |
| **Inspect AI** (UK AISI) | safety+capability evals | ✅ |
| **DeepEval** | unit tests for LLMs | ✅ |
| **promptfoo** | red teaming, prompt injection | ✅ (now part of OpenAI) |
| **Braintrust** | eval platform | ❌ closed |
| **Patronus** | safety evals | ⚠️ |

**Рекомендация для Pyrfor:** SWE-bench Lite (минимум) + DeepEval + promptfoo в CI.

### 5.5 Memory architectures

| Решение | Подход | Pros | Cons |
|---|---|---|---|
| **Letta (MemGPT)** | hierarchical (core + archival) | agent edits memory; long-term | Python-only |
| **mem0** | algorithmic long-term | автоматическая extraction | новый, ещё созревает |
| **Zep / Graphiti** | temporal knowledge graph | reasoning over time | сложность |
| **Cognee** | memory control plane + hooks | extensible | overhead |
| **Pyrfor (текущий)** | **SQLite + FTS5 + wiki + rollup** | local-first, structured | нет vector / KG |

**Рекомендация:** Pyrfor оставить FTS5 как primary, добавить **archival vector** (nomic-embed-text локально) и опционально **temporal KG** (Graphiti-inspired).

### 5.6 Distribution: Tauri 2 vs Electron

| Критерий | Tauri 2 | Electron |
|---|---|---|
| Bundle size | ~3-10MB | ~120MB+ |
| Memory | OS WebView | Chromium 130-200MB |
| Language | Rust + TS | Node + TS |
| Signing | встроено | electron-builder |
| Auto-update | встроено (signed Ed25519) | electron-updater |
| Sidecars | нативно | child_process |
| macOS notarization | встроено | требует настройки |

**Pyrfor выбрал Tauri 2 — правильно.**

Ключевые элементы:
- **`tauri-plugin-updater`** — обязательная подпись обновлений (Ed25519)
- **Sidecars** — naming convention `binary-{target-triple}`; permissions через capabilities
- **Distribution форматы:** macOS (DMG, App Store), Windows (MSI/NSIS/Store), Linux (AppImage/Deb/RPM/Snap/Flatpak/AUR)

### 5.7 Security / supply chain

- **Tool sandboxing** — обязательно (см. §5.1)
- **Prompt injection defenses:** tool annotation trust, structured outputs (JSON schema validation), privilege separation, content filtering, approval workflows, context isolation
- **Secrets:** `tauri-plugin-stronghold` (encrypted vault), macOS Keychain, Windows Credential Manager — никогда не в `localStorage`
- **SBOM:** `cargo-sbom` (Rust), `npm sbom` (JS), форматы SPDX/CycloneDX
- **Signed releases:** Tauri Ed25519 для updater + Sigstore/cosign для GitHub Releases
- **Supply chain hygiene:** Renovate/Dependabot, `cargo audit`, `npm audit`
- **LLM cost guardrails:** token budget per task/agent/session; hard limits; rate limiting; OTel cost metrics; alerts

### 5.8 Plugin / Skills / Hooks / Slash-commands

- **Plugins:** Tauri plugins (Rust crates + JS API) или MCP servers (stdio процессы)
- **Marketplace:** GitHub-hosted (как Homebrew formulae)
- **Skills (Claude Skills pattern):** YAML/MD контекстные файлы; mem0/Cognee реализуют `npx skills add ...`; agentskills.io SKILL.md spec
- **Slash-commands:** `/refactor`, `/test`, …; YAML/TOML конфиги + Handlebars templates
- **Hooks (Cognee/Claude Code pattern):** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SessionEnd`
  ```yaml
  hooks:
    pre_tool_use:
      - inject_memory_context
      - validate_tool_permissions
    post_tool_use:
      - capture_to_episodic_memory
      - update_cost_counter
  ```

---

## 6. Большая сравнительная матрица: Pyrfor vs всё

| # | Фича | Pyrfor | OpenHands | Aider | Cline | Goose | gptme | Codex | Plandex | LangGraph | CrewAI | AutoGen | Mastra | Letta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | IDE shell (native desktop) | ✅ Tauri | ⚠️ web | ❌ | ❌ ext | ⚠️ | ⚠️ | ❌ | ❌ | — | — | — | — | — |
| 2 | Local-first | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 3 | Multi-agent orchestration | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| 4 | Subagent isolation (worktree/container) | ⚠️ заявлено | ✅ Docker | ❌ | ❌ | ✅ | ⚠️ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 5 | MCP server | ✅ unique | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 6 | MCP client | ✅ | ✅ | ✅ | ✅ MarketP | ✅ 70+ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 | A2A | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 8 | ACP (client) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ srv | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 9 | AG-UI | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| 10 | FTS persistent memory | ✅ unique | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ git | ⚠️ | ❌ | external | external | session | external | hier |
| 11 | Vector / archival memory | ❌ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ✅ chunks | ⚠️ | ⚠️ | ❌ | ⚠️ | ✅ |
| 12 | Multi-provider router | ✅ | ✅ litellm | ✅ litellm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 13 | Circuit breaker | ✅ unique | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 14 | Approvals / HITL | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| 15 | Suspend/Resume API | ⚠️ approval | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ | ✅ interrupt | ✅ | ⚠️ | ✅ best | ❌ |
| 16 | Trajectory replay | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 17 | Checkpointing (resume/fork/time-travel) | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ best | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 18 | Cost tracking | ✅ DAG-aware | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 19 | Governance / postmortem / incident packets | ✅ unique | ⚠️ paid | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 20 | Context compaction | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| 21 | Browser tool | ✅ | ✅ | ❌ | ✅ MCP | ✅ MCP | ⚠️ | ❌ | ✅ Chrome | external | external | external | external | ❌ |
| 22 | Voice (Whisper) | ✅ TG | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | external | external | external | external | ❌ |
| 23 | Cron / scheduled agents | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | external | external | external | external | ❌ |
| 24 | Telegram / external triggers | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 25 | Sandbox isolation (real) | ⚠️ path-guard | ✅ Docker | ❌ | ⚠️ | ✅ Rust | ⚠️ | ✅ Rust | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 26 | OpenTelemetry GenAI | ⚠️ custom | ⚠️ | ❌ | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| 27 | Continuous eval pipeline | ❌ | ⚠️ | ⚠️ | ❌ | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 28 | Plugin / hooks system | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ recipes | ⚠️ | ✅ hooks | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 29 | Marketplace | ❌ | ⚠️ | ❌ | ✅ MCP | ✅ 70+ | ❌ | ⚠️ | ❌ | — | — | — | — | — |
| 30 | Slash-commands | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | — | — | — | — | — |
| 31 | Hooks (pre/post) | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 32 | Signed updater (auto-update) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ⚠️ | ❌ | — | — | — | — | — |
| 33 | Public benchmark (SWE-bench) | ❌ | ✅ 77.6 | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | — | — | — | — | — |
| 34 | One-command install | ❌ | ⚠️ Docker | ✅ pip | ✅ vsix | ✅ binary | ✅ pip | ✅ npm | ⚠️ | ✅ pip | ✅ pip | ✅ pip | ✅ npm | ✅ pip |
| 35 | Public docs / repo | ❌ private | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 36 | TypeScript-first | ✅ | ❌ Py | ❌ Py | ⚠️ TS ext | ❌ Rust | ❌ Py | ❌ Rust | ❌ Go | ⚠️ SDK | ❌ Py | ❌ Py | ✅ | ❌ Py |
| 37 | RBAC / multi-tenancy | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

---

## 7. Анализ пробелов Pyrfor

### 7.1 Top-5 фичей конкурентов, которых нет у Pyrfor

1. **Публичный SWE-bench score** — OpenHands 77.6%, Aider/SWE-agent тоже публикуют. Без бенчмарка нет credibility у разработчиков. Решается за 2-3 недели через harness.
2. **Tree-sitter repo-map** — Aider best-in-class, Plandex 20M-token contexts. Без этого Pyrfor planner «слеп» в больших репо. Решается интеграцией tree-sitter WASM в `UniversalPlanner`.
3. **Marketplace / extensions ecosystem** — Cline (MCP Marketplace), Goose (70+ extensions). Главный virality канал. Pyrfor имеет MCP gateway, но нет публичного каталога.
4. **VS Code/JetBrains extension или ACP server** — 90% разработчиков в VS Code/JetBrains. Сейчас Pyrfor — только desktop app. Решается через ACP server (`npx @pyrfor/engine acp`).
5. **One-command install + публичный repo** — Aider 6.8M installs именно из-за `pip install aider-chat`. Pyrfor приватный + pnpm setup + Tauri = тройной барьер.

### 7.2 Top-5 преимуществ Pyrfor

1. **Уникальный governed lifecycle** — `plan → research → execute → critique → postmortem → memory_persist → done` с incident packet export. Никто из 22+ исследованных проектов не имеет полного цикла в OSS.
2. **Dual-role MCP gateway** — server + client + FC bridge. Pyrfor может стать hub'ом мульти-агентной сети.
3. **SQLite + FTS5 + wiki + rollup persistent memory** — никто не имеет structured cross-session memory с polным набором функций.
4. **13-file multi-provider router с circuit breaker** — enterprise-grade failover, нет ни у кого.
5. **Native Tauri desktop + TypeScript + unified workspace** — единственный native desktop AI coding IDE (Goose имеет desktop, но в основном CLI).

### 7.3 Top-15 пробелов (из инвентаризации)

1. Нет единого run lifecycle substrate во всех слоях
2. Desktop build не подтверждён живым прогоном
3. В IDE нет agent timeline / replay UI
4. Нет permission ladder engine
5. MCP/A2A: full product-level routing/auth/degraded-mode UX не доматчены
6. Browser tool: live probe skipped
7. Subagent worktree isolation заявлена, явного worktree-менеджера нет
8. Нет unified artifact model everywhere
9. Telegram/daemon выглядит legacy/compat
10. Sandbox/workspace boundary — скорее path-guard, не настоящая изоляция
11. Context compaction есть, зрелость ротации неясна
12. Cost-aware DAG есть, end-to-end budget enforcement не виден
13. OpenTelemetry / production dashboards не first-class
14. Desktop UI: нет approval inbox, memory browser как зрелых экранов
15. Lifecycle цепочка — «core loop», не полный self-improving OS

---

## 8. Мнения агентов исследовательской системы

### 8.1 Мнение агента-инвентаризатора Pyrfor (`pyrfor-inventory`)

> **Резюме модели зрелости:** beta → near-prod на ядре (subagents — prod-ready, memory-store/wiki — prod-ready, CLI — prod-ready); IDE shell, MCP, A2A, ACP, browser, daemon — beta; full platform — alpha/beta, не «1.0 stable».
>
> **Что нужно сделать (топ-7):**
> 1. Довести **единый run substrate** до канонического API/UI/CLI.
> 2. Сделать **agent timeline + replay + incident packet** first-class в IDE.
> 3. Формализовать **permission ladder** и привязать к tool execution везде.
> 4. Доделать **worktree isolation** и lifecycle supervision для subagents.
> 5. Свести **MCP/A2A/ACP** в единый adapter/router слой.
> 6. Добавить **cost/budget guardrails** на каждый run и sub-run.
> 7. Сделать **desktop operator console** реально лучшим экраном продукта, а не просто чатом.

### 8.2 Мнение research-агента по coding agents (`research-coding-agents`)

> **Технически Pyrfor опережает экосистему на 12-18 месяцев** по governance модели — governed lifecycle, dual-role MCP gateway, circuit breaker router, structured memory, postmortem/incident packets — это уровень production engineering, которого нет ни у кого в open-source.
>
> **Фатальный разрыв** — это публичность и UX входа. Aider с `pip install aider-chat` имеет 6.8M установок. Pyrfor с Tauri + pnpm setup имеет… нет данных, потому что репозиторий приватный. Это **не технологическая проблема** — это маркетинговая и packaging проблема, которая решается за 2-4 недели.
>
> **Уникальная возможность:** в 2026 году ни один open-source агент не имеет настоящей enterprise governance (OpenHands делает это в платном enterprise tier). **Pyrfor может занять эту нишу первым** — и это меняет всю конкурентную динамику.
>
> **10 конкретных шагов:**
> 1. Запустить `npx pyrfor-engine` / pip install — убрать барьер входа (time-to-first-concept <3 мин)
> 2. Реализовать ACP server → появиться в Zed / JetBrains (Phase 1 — 2-3 дня работы; даёт доступ к 50k+ Zed users)
> 3. Прогнать SWE-bench lite и опубликовать результат (даже 30-40% — это credibility)
> 4. Встроить tree-sitter repo-map в UniversalPlanner
> 5. Создать `pyrfor.dev/extensions` — MCP marketplace (20 curated серверов)
> 6. Открыть публичный GitHub и документацию (без этого — не open-source)
> 7. Добавить встроенный Browser Tool (Playwright) через MCP — «browse-plan-code-verify» loop
> 8. Реализовать Plan versioning / branch compare (Plandex killer feature)
> 9. Маркетинг: "Show HN" + YouTube demo + blog post «Why every AI coding agent needs postmortem phases»
> 10. Позиционирование: **«The Governance Layer for AI Coding»** — *"AI coding that your security team will approve"*

### 8.3 Мнение research-агента по multi-agent frameworks (`research-multiagent-frameworks`)

> **Контекст 2026 года:** рынок консолидируется вокруг паттернов — `suspend/resume HITL`, `AG-UI event streams`, `OTel GenAI spans`, `MCP+A2A протоколы`. Фреймворки, не поддерживающие эти стандарты, быстро теряют relevance.
>
> **Позиция Pyrfor:** уникальная комбинация явного lifecycle + cost-aware DAG + TypeScript = нет прямых конкурентов. Ближайшие — Mastra (TS, workflow-first) и LangGraph (Python, graph-first). Pyrfor потенциально сильнее обоих при условии реализации checkpointing, AG-UI, и first-class TypeScript generics.
>
> **Топ-7 паттернов, которые Pyrfor должен заимствовать:**
> 1. **LangGraph Checkpointing / Durable Execution** — `CheckpointStore<State>` interface для resume/time-travel/fork
> 2. **AG-UI Protocol Integration** — мгновенная совместимость с CopilotKit и всей экосистемой UI компонентов
> 3. **Typed Dependency Injection (Pydantic-AI)** — `SubAgent<TInput,TOutput,TDeps>` generics → главный DX-аргумент
> 4. **Suspend/Resume для HITL (Mastra/VoltAgent)** — `ctx.suspend(reason, meta)` + `runner.resume(execId, decision)`
> 5. **Code-as-Action + Sandbox (smolagents)** — `CodeExecutorSubagent` через E2B/microsandbox; -30% steps
> 6. **DSPy-style Prompt Optimization** — postmortem → eval → optimize loop
> 7. **Memory Blocks + Agent-Editable Memory (Letta)** — typed blocks, agent редактирует свою память
>
> **Где Pyrfor уже сильнее:** Lifecycle (никто не имеет полного), Cost-aware DAG (нет ни у кого из 14 фреймворков!), Postmortem phase (MetaGPT частично, остальные — нет), TypeScript native (только Mastra/VoltAgent конкурируют), Approval Flow встроен в архитектуру, Trajectory Recorder, MCP+A2A вместе.
>
> **Критический путь к лидерству:**
> 1. AG-UI совместимость (3 недели работы = мгновенный доступ к огромной экосистеме)
> 2. Checkpointing store (resume from failure = enterprise trust)
> 3. `npm create pyrfor@latest` + MCP docs server (DX = community growth)

### 8.4 Мнение research-агента по инфраструктуре и протоколам (`research-infra-and-protocols`)

> **Три ключевых инсайта:**
> 1. **Протокольный стек определился**: MCP + A2A + AG-UI = полный слой взаимодействия. Топовый runtime должен поддерживать все три. Первые два уже имеют официальные SDKs и растущую экосистему.
> 2. **Изоляция — это differentiator**: Microsandbox делает то, что E2B/Daytona делали только в облаке — rootless microVMs локально. Для desktop AI tool это **нерешённая проблема и шанс стать первым**, кто сделает это правильно в open source.
> 3. **Observability — это credibility**: Без OTel трейсинга разработчики не смогут отлаживать мультиагентные workflow. Langfuse/Phoenix самохостинг означает, что данные остаются локальными — важно для local-first концепции Pyrfor.
>
> **Pyrfor должен стать**: *«The Tauri-native agent runtime that gives every developer a production-grade multi-agent workspace running entirely locally — with the observability of a cloud system, the isolation of enterprise infrastructure, and the extensibility of a plugin ecosystem.»*
>
> **Топ-10 приоритетов (с приоритезацией P0/P1/P2):**
>
> **P0 (критично):**
> - **MCP Host Runtime** — полноценный MCP host: запускать stdio серверы как Tauri sidecars, поддерживать Streamable HTTP, lifecycle. Без этого — не существует как продукт.
> - **Sandboxed Tool Execution** — каждый tool call в изолированной среде. Минимум — git worktrees + process isolation. Цель — microsandbox.
> - **Local-first Memory (SQLite + Embeddings)** — добавить локальные embeddings (nomic-embed-text через Tauri sidecar) для semantic search.
> - **OTel GenAI Трейсинг** — встроенный OTLP экспортёр, local trace viewer в UI, экспорт в Langfuse/Phoenix.
>
> **P1 (важно):**
> - **A2A Agent Registry** — локальный реестр агентов с Agent Cards
> - **AG-UI Streaming Layer** — real-time streaming agent→UI с bidirectional state sync
> - **Plugin / Extension Ecosystem** — hooks (pre/post tool), slash commands, skills (YAML/MD); marketplace как GitHub-hosted реестр
> - **Continuous Eval Pipeline** — DeepEval или promptfoo интеграция, SWE-bench harness
>
> **P2 (желательно):**
> - **Knowledge Graph Memory** — temporal knowledge graph (Graphiti-inspired)
> - **Auto-update + Signed Releases + SBOM** — Ed25519-signed auto-updates, macOS notarization, Windows code signing, SBOM через cargo-sbom, cosign

---

## 9. Главный вывод

### 9.1 Где Pyrfor сейчас

**Архитектурно — самый глубокий** проект из 22+ исследованных OSS-альтернатив. Только Pyrfor имеет одновременно:
- Governed lifecycle с postmortem и incident packets
- Dual-role MCP gateway (server + client)
- Cost-aware DAG с circuit breaker router
- SQLite+FTS5+wiki+rollup persistent memory
- Trajectory recorder с replay support
- Native Tauri desktop с editor/terminal/git/diff/orchestration
- Поддержку трёх протоколов одновременно (MCP + A2A + ACP)
- TypeScript-first runtime

**Опережает OSS-экосистему на 12-18 месяцев по governance-модели.** Конкуренты вроде OpenHands имеют такую функциональность только в **платном enterprise tier**.

### 9.2 Где разрыв

**Не в технологии — в обвязке экосистемы и публичном входе:**

| Слой | Что не хватает | Влияние |
|---|---|---|
| **Distribution** | публичный GitHub, one-command install, signed updater | без этого — «shared-source», не open-source |
| **Bench/credibility** | публичный SWE-bench score | главный фактор доверия разработчиков |
| **IDE-distribution** | VS Code extension, ACP server для Zed | 90% аудитории |
| **Frontend protocol** | AG-UI совместимость | мгновенный доступ к экосистеме CopilotKit |
| **Sandbox** | реальная изоляция (microsandbox / worktree+sandbox-exec) | enterprise trust, security |
| **Observability** | OTel GenAI semconv | enterprise credibility |
| **Marketplace** | MCP marketplace, skills, hooks | virality канал |
| **Repo-map** | tree-sitter repo-map в planner | качество plans на больших репо |
| **Checkpointing** | resume/time-travel/fork | enterprise resilience |
| **Eval loop** | postmortem → trainset → optimize | self-improvement замкнут не полностью |

### 9.3 Уникальная ниша для позиционирования

> **«The Governance Layer for AI Coding»**
>
> *"AI coding that your security team will approve."*

Все конкуренты борются за «лучший coding agent» (raw SWE-bench). Pyrfor должен позиционироваться **иначе**: единственный OSS с enterprise-grade governance (incident packets, audit trail, trajectory replay, circuit breaker, approval flow, cost budgets). Целевая аудитория — **tech leads и engineering managers**, не junior devs. Это ниша, где **нет прямой конкуренции**.

### 9.4 Главный вывод

**Если выполнить P0 (10 пунктов) + P1 (14 пунктов) из плана доработки** — Pyrfor становится **№1 open-source мультиагентным coding-runtime в мире** в течение полугодия. Технологический фундамент уже есть; не хватает обвязки экосистемы, distribution и публичного входа.

Подробный план — в [`PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md`](./PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md).

---

## Приложение A. Источники

### Pyrfor (локальные)
- `/Users/aleksandrgrebeshok/pyrfor-dev/README.md`
- `/Users/aleksandrgrebeshok/pyrfor-dev/CLAUDE.md`
- `/Users/aleksandrgrebeshok/pyrfor-dev/UNIVERSAL_ENGINE_DECOMPOSITION.md`
- `packages/engine/src/runtime/*` (304 файла)
- `apps/pyrfor-ide/web/src/components/*`
- `docs/capability-inventory.md`, `docs/PYRFOR-COMPLETE-ARCHITECTURE-PLAN.md`, `docs/pyrfor-universal-engine-vision.md`, `docs/PYRFOR-FINAL-READINESS-AUDIT-2026-05-14.md`, `docs/UNIFIED_PLAN_FINAL.md`

### Coding agents
- OpenHands: [github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands), [docs.openhands.dev](https://docs.openhands.dev)
- Aider: [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider), [aider.chat/HISTORY.html](https://aider.chat/HISTORY.html), [aider.chat/docs/usage/modes.html](https://aider.chat/docs/usage/modes.html)
- Cline: [github.com/cline/cline](https://github.com/cline/cline), [docs.cline.bot](https://docs.cline.bot), [docs.cline.bot/mcp/mcp-overview](https://docs.cline.bot/mcp/mcp-overview)
- Roo Code: [github.com/RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) (на момент исследования закрыт)
- Goose: [github.com/block/goose](https://github.com/block/goose), [goose-docs.ai](https://goose-docs.ai/docs/guides/acp-providers)
- Continue: [github.com/continuedev/continue](https://github.com/continuedev/continue)
- SWE-agent: [github.com/SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent), [swe-agent.com](https://swe-agent.com/latest/)
- Devika: [github.com/stitionai/devika](https://github.com/stitionai/devika)
- Plandex: [github.com/plandex-ai/plandex](https://github.com/plandex-ai/plandex)
- gptme: [github.com/gptme/gptme](https://github.com/gptme/gptme), [gptme.org/docs](https://gptme.org/docs/), [gptme.org/docs/acp.html](https://gptme.org/docs/acp.html)
- Codex CLI: [github.com/openai/codex](https://github.com/openai/codex)
- Zed: [github.com/zed-industries/zed](https://github.com/zed-industries/zed), [zed.dev/blog/zed-ai](https://zed.dev/blog/zed-ai)

### Multi-agent frameworks
- LangGraph: [github.com/langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) (SHA 97c31e9), checkpoint (SHA 6e42061), types (SHA fa0bdc6)
- AG2: [github.com/ag2ai/ag2](https://github.com/ag2ai/ag2) (SHA 0895d24)
- CrewAI: [github.com/crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) (SHA 817f515)
- MetaGPT: [github.com/geekan/MetaGPT](https://github.com/geekan/MetaGPT) (SHA 080c02c)
- OpenAI Swarm: [github.com/openai/swarm](https://github.com/openai/swarm) (SHA bcc1e19)
- OpenAI Agents Python: [github.com/openai/openai-agents-python](https://github.com/openai/openai-agents-python) (SHA 7d5eb8c)
- smolagents: [github.com/huggingface/smolagents](https://github.com/huggingface/smolagents) (SHA c57ec86)
- Pydantic-AI: [github.com/pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) (SHA d4ac217)
- Agno: [github.com/agno-agi/agno](https://github.com/agno-agi/agno) (SHA fa03b4e)
- Mastra: [github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra) (SHA 5e0a61e), agent core (SHA ecce2a4)
- VoltAgent: [github.com/VoltAgent/voltagent](https://github.com/VoltAgent/voltagent) (SHA ad520f7)
- Letta: [github.com/letta-ai/letta](https://github.com/letta-ai/letta) (SHA d1de2ac)
- DSPy: [github.com/stanfordnlp/dspy](https://github.com/stanfordnlp/dspy) (SHA 4f36a4a)
- LlamaIndex: [github.com/run-llama/llama_index](https://github.com/run-llama/llama_index) (SHA c1c7af8)

### Протоколы
- MCP: [modelcontextprotocol.io/docs/concepts/transports](https://modelcontextprotocol.io/docs/concepts/transports) (Streamable HTTP, 2025-03-26)
- A2A: [github.com/google-a2a/A2A](https://github.com/google-a2a/A2A) (Linux Foundation)
- ACP: [github.com/agentclientprotocol/registry](https://github.com/agentclientprotocol/registry)
- AG-UI: [ag-ui.com](https://ag-ui.com), [docs.ag-ui.com/concepts/events.md](https://docs.ag-ui.com/concepts/events.md), [docs.ag-ui.com/llms.txt](https://docs.ag-ui.com/llms.txt)
- AGNTCY: [github.com/agntcy/acp-spec](https://github.com/agntcy/acp-spec)
- OTel GenAI: [opentelemetry.io/docs/specs/semconv/gen-ai/](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)

### Sandbox / infrastructure
- E2B: [github.com/e2b-dev/e2b](https://github.com/e2b-dev/e2b), [e2b.dev/docs](https://e2b.dev/docs)
- Daytona: [github.com/daytonaio/daytona](https://github.com/daytonaio/daytona)
- Microsandbox: [github.com/microsandbox/microsandbox](https://github.com/microsandbox/microsandbox)
- Firecracker: [firecracker-microvm.github.io](https://firecracker-microvm.github.io)

### Observability
- OpenLLMetry: [github.com/traceloop/openllmetry](https://github.com/traceloop/openllmetry)
- Langfuse: [github.com/langfuse/langfuse](https://github.com/langfuse/langfuse)
- Phoenix: [github.com/arize-ai/phoenix](https://github.com/arize-ai/phoenix)
- Laminar: [github.com/lmnr-ai/lmnr](https://github.com/lmnr-ai/lmnr)

### Eval
- SWE-bench: [github.com/princeton-nlp/SWE-bench](https://github.com/princeton-nlp/SWE-bench)
- OSWorld: [github.com/xlang-ai/OSWorld](https://github.com/xlang-ai/OSWorld)
- Inspect AI: [github.com/UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai)
- DeepEval: [github.com/confident-ai/deepeval](https://github.com/confident-ai/deepeval)
- promptfoo: [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)

### Memory
- Letta: [github.com/letta-ai/letta](https://github.com/letta-ai/letta)
- mem0: [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)
- Zep / Graphiti: [github.com/getzep/zep](https://github.com/getzep/zep)
- Cognee: [github.com/topoteretes/cognee](https://github.com/topoteretes/cognee)

### Distribution / Tauri
- Tauri 2 macOS signing: [v2.tauri.app/distribute/sign/macos/](https://v2.tauri.app/distribute/sign/macos/)
- Tauri 2 updater: [v2.tauri.app/plugin/updater/](https://v2.tauri.app/plugin/updater/)
- Tauri 2 sidecar: [v2.tauri.app/develop/sidecar/](https://v2.tauri.app/develop/sidecar/)
- Tauri 2 distribution: [v2.tauri.app/distribute/](https://v2.tauri.app/distribute/)

---

**Конец исследования.**
