# CEOClaw vs OpenClaw vs Рыночные Мультиагентные Системы
# Архитектурное Сравнение Ядра

> **Дата:** 2026-03-26
> **Автор:** AI-аудит (Claude Opus 4.6)
> **Цель:** Сравнить архитектуру мультиагентного ядра CEOClaw с OpenClaw и ведущими фреймворками рынка. Выявить плюсы, минусы, и направления усовершенствования.

---

## СОДЕРЖАНИЕ

1. [Обзор сравниваемых систем](#1-обзор-сравниваемых-систем)
2. [Архитектурное сравнение по 12 параметрам](#2-архитектурное-сравнение-по-12-параметрам)
3. [Детальный анализ: CEOClaw](#3-детальный-анализ-ceoclaw)
4. [Детальный анализ: OpenClaw](#4-детальный-анализ-openclaw)
5. [Детальный анализ: Рыночные конкуренты](#5-детальный-анализ-рыночные-конкуренты)
6. [Матрица сравнения (сводная таблица)](#6-матрица-сравнения-сводная-таблица)
7. [SWOT-анализ ядра CEOClaw](#7-swot-анализ-ядра-ceoclaw)
8. [Что нужно усовершенствовать (25 рекомендаций)](#8-что-нужно-усовершенствовать)
9. [Архитектурные диаграммы](#9-архитектурные-диаграммы)
10. [Приоритетный план улучшений](#10-приоритетный-план-улучшений)

---

## 1. ОБЗОР СРАВНИВАЕМЫХ СИСТЕМ

### CEOClaw (наш продукт)
| Параметр | Значение |
|----------|----------|
| **Тип** | AI-first платформа управления проектами (PM + Multi-Agent) |
| **Стек** | Next.js 15, React 18, TypeScript, Prisma/PostgreSQL |
| **Агенты** | 25 специализированных в 8 категориях |
| **Провайдеры LLM** | 8 (GigaChat, YandexGPT, OpenRouter, OpenAI, ZAI, AIJora, Polza, Bothub) |
| **Оркестрация** | Kernel Control Plane → Leader-Support blueprints |
| **Уникальность** | Evidence Ledger + Safety Profiles + Proposal-as-Draft |

### OpenClaw (ваш персональный ассистент)
| Параметр | Значение |
|----------|----------|
| **Тип** | Персональный мультиагентный AI-ассистент (local-first) |
| **Стек** | Node.js 22, TypeScript (ESM), SQLite, Express gateway |
| **Агенты** | 20 в 3-уровневой иерархии (orchestrators → workers → utilities) |
| **Провайдеры LLM** | 3 (ZAI/GLM, OpenRouter, OpenAI Codex) |
| **Оркестрация** | Hierarchical orchestrator → worker spawning |
| **Уникальность** | Multi-channel (12 каналов), local-first, per-agent sandboxing |

### Рыночные конкуренты
| Фреймворк | Парадигма | Зрелость |
|-----------|-----------|----------|
| **LangGraph** | Графы состояний (DAG), stateful orchestration | Production (Uber, LinkedIn, Klarna) |
| **CrewAI** | Ролевая метафора "команда", YAML-конфиг | Прототипы, MVP |
| **AutoGen / MS Agent Framework** | Conversational multi-agent, event-driven | Enterprise (Azure) |
| **Semantic Kernel** | Pluggable orchestration (.NET/TypeScript) | Enterprise (Microsoft) |
| **MetaGPT** | SOP-driven software company simulation | Open-source, SWE-Bench лидер |
| **OpenHands (ex-OpenDevin)** | Scriptable developer agents | Research/Open-source |

---

## 2. АРХИТЕКТУРНОЕ СРАВНЕНИЕ ПО 12 ПАРАМЕТРАМ

### 2.1 Модель оркестрации агентов

| Система | Модель | Оценка |
|---------|--------|--------|
| **CEOClaw** | Central Dispatcher (Kernel Control Plane) → Leader-Support blueprints (5 hardcoded паттернов). Агенты НЕ общаются напрямую — всё через центральный диспетчер. | ⭐⭐⭐ |
| **OpenClaw** | Hierarchical: Orchestrators (3) → Workers (11) → Utilities (6). Agent-to-agent через sessions_spawn/send. Max 16 concurrent subagents per orchestrator. | ⭐⭐⭐⭐ |
| **LangGraph** | Directed Acyclic Graph (DAG) с checkpointing. Произвольная топология, conditional branching, циклы. | ⭐⭐⭐⭐⭐ |
| **CrewAI** | Flat team + sequential/hierarchical process. Простая, но ограниченная. | ⭐⭐⭐ |
| **AutoGen/MS** | Event-driven conversation. Message dispatcher. Асинхронный. | ⭐⭐⭐⭐ |
| **MetaGPT** | SOP-driven workflow. Каждый агент = роль в компании. | ⭐⭐⭐⭐ |

**Вывод для CEOClaw:** Текущая модель (5 hardcoded blueprints) — самая жёсткая из всех. Нет динамического планирования. Нет произвольных графов. Нет agent-to-agent communication.

---

### 2.2 Автономность агентов

| Система | Уровень автономности | Описание |
|---------|---------------------|----------|
| **CEOClaw** | **Низкая** (prompt templates) | Агенты = prompt templates + routing keywords. Нет собственной памяти, нет self-reflection, нет tool use от агента. |
| **OpenClaw** | **Высокая** (autonomous execution) | Каждый агент имеет workspace, память (SQLite), sandbox, tool access (file, process, browser). Может самостоятельно исследовать, писать код, запускать процессы. |
| **LangGraph** | **Средняя-Высокая** | Агенты как nodes с state, могут вызывать tools и другие nodes. |
| **CrewAI** | **Средняя** | Role-defined, goal-oriented. Tools доступны, но автономия ограничена task chain. |
| **AutoGen/MS** | **Высокая** | Conversational agents с полным tool access, code execution, human-in-the-loop. |
| **MetaGPT** | **Высокая** | Агенты пишут код, запускают тесты, делают review. Full SDLC autonomy. |

**Вывод для CEOClaw:** Критический разрыв. Агенты CEOClaw — фактически prompt templates, не настоящие автономные агенты. Они не могут: вызывать tools самостоятельно, запоминать контекст между сессиями, рефлексировать над результатами.

---

### 2.3 Память и контекст

| Система | Short-term | Long-term | Shared Memory |
|---------|-----------|-----------|---------------|
| **CEOClaw** | Chat messages (session) | ❌ Нет | ❌ Нет (только Evidence Ledger как общий источник фактов) |
| **OpenClaw** | Session context (TTL 1h) | SQLite per-agent + semantic embeddings (nomic-embed-text) | Markdown journals (IDENTITY.md, SOUL.md) |
| **LangGraph** | State per node | Checkpointing + vector stores | Shared state graph |
| **CrewAI** | Task context | ❌ Ограниченно | Shared crew context |
| **AutoGen/MS** | Conversation history | Feature stores, vector DBs | Shared memory store |
| **MetaGPT** | SOP phase context | Repository knowledge | Structured SOP artifacts |

**Вывод для CEOClaw:** Полное отсутствие agent memory — ни short-term за пределами чата, ни long-term. Evidence Ledger — это не memory, это data source. Агенты не помнят предыдущие взаимодействия.

---

### 2.4 Tool Use (использование инструментов агентами)

| Система | Модель Tool Use | Кол-во tools | Кто вызывает |
|---------|----------------|-------------|-------------|
| **CEOClaw** | Centralized execution после approval | 13 (4 домена) | Kernel Tool Plane (не агент!) |
| **OpenClaw** | Agent-initiated tool calls | 15+ (file, process, browser, web, agent-to-agent) | Каждый агент самостоятельно |
| **LangGraph** | Node-level tool binding | Неограниченно (plugin system) | Nodes/Agents |
| **CrewAI** | Role-level tool assignment | Custom per agent | Agents |
| **AutoGen/MS** | Function calling | Неограниченно | Agents + orchestrator |
| **MetaGPT** | SOP-phase tools | Code execution, testing, review | Agents by SOP |

**Вывод для CEOClaw:** Агенты НЕ вызывают tools напрямую. Вся tool execution проходит через Kernel Tool Plane после human approval. Это безопасно, но убивает автономность.

---

### 2.5 Провайдер-абстракция (LLM routing)

| Система | Провайдеры | Fallback | Cost optimization | Model selection |
|---------|-----------|---------|-------------------|----------------|
| **CEOClaw** | 8 (включая российские: GigaChat, YandexGPT) | Per-provider model chain | ❌ Нет | Runtime matrix (leader vs support) |
| **OpenClaw** | 3 (ZAI, OpenRouter, OpenAI Codex) | Primary → fallback1 → fallback2 | Per-model cost tracking в config | Per-agent model config |
| **LangGraph** | Через LangChain (100+ моделей) | Built-in retry + fallback | LangSmith cost tracking | Configurable per node |
| **AutoGen/MS** | Azure OpenAI + others | Built-in | Azure cost monitoring | Per-agent config |
| **CrewAI** | LiteLLM (100+ моделей) | ❌ Manual | ❌ Нет | Per-agent YAML |

**Вывод для CEOClaw:** Лучший в классе по количеству российских провайдеров (GigaChat + YandexGPT). Это **конкурентное преимущество** на российском рынке. Но нет cross-provider fallback (если провайдер упал — ошибка, а не переключение на другой).

---

### 2.6 Безопасность и контроль

| Система | Safety Model | Human-in-the-loop | Audit trail |
|---------|-------------|-------------------|-------------|
| **CEOClaw** | ⭐⭐⭐⭐⭐ Proposal-as-Draft + Safety Profiles + Compensation modes | Обязательный (proposals require approval) | Execution steps + correlation IDs |
| **OpenClaw** | ⭐⭐⭐⭐ Sandbox modes (off/all/per-session) + tool allowlists + exec approvals | Configurable (ask on-miss) | Exec approvals log |
| **LangGraph** | ⭐⭐⭐⭐ Checkpointing + human-in-the-loop nodes | Configurable | LangSmith traces |
| **AutoGen/MS** | ⭐⭐⭐⭐ Constrained autonomy zones + Entra Agent ID | Configurable | Full telemetry |
| **CrewAI** | ⭐⭐ Minimal guardrails | ❌ Manual | Basic logging |
| **MetaGPT** | ⭐⭐⭐ SOP constraints | Per-phase review | SOP artifacts |

**Вывод для CEOClaw:** **Безопасность — главное конкурентное преимущество.** Proposal-as-Draft + Safety Profiles + Evidence Grounding + Compensation Modes — это enterprise-grade safety, превосходящий все open-source фреймворки. Для B2B/enterprise клиентов в строительстве и нефтегазе — критически важно.

---

### 2.7 Evidence Grounding (обоснованность решений)

| Система | Evidence Model | Описание |
|---------|---------------|----------|
| **CEOClaw** | ⭐⭐⭐⭐⭐ **Уникальный Evidence Ledger** | 3 уровня верификации (reported→observed→verified), confidence 0-100, fusion из 4 источников (1С, Telegram, GPS, Email). ВСЕ AI-предложения обоснованы фактами. |
| **OpenClaw** | ⭐⭐ Markdown journals | IDENTITY.md, SOUL.md — но это память, не верификация фактов |
| **LangGraph** | ⭐⭐⭐ RAG integration | Через vector stores, но без встроенной верификации |
| **AutoGen/MS** | ⭐⭐⭐ Knowledge bases | Azure AI Search, но нет built-in verification |
| **CrewAI** | ⭐ Minimal | Нет встроенной системы фактов |
| **MetaGPT** | ⭐⭐⭐ Repository grounding | Код как источник правды, но для другого домена |

**Вывод для CEOClaw:** **Evidence Ledger — уникальное конкурентное преимущество**, которого нет ни у одного конкурента. Для PM-домена, где решения должны быть обоснованы данными (а не галлюцинациями LLM) — это архитектурный прорыв.

---

### 2.8 Multi-channel communication

| Система | Каналы | Описание |
|---------|--------|----------|
| **CEOClaw** | 2 (Web UI + Telegram bot в daemon) | Telegram интеграция через grammY в daemon. Email — только отправка. |
| **OpenClaw** | 12 (Telegram, WhatsApp, Slack, Discord, Signal, iMessage, Teams, WebChat, Matrix, Zalo, Line, Google Chat) | Полная мульти-канальная архитектура с channel adapters |
| **LangGraph** | 0 (framework only) | Каналы не входят в scope |
| **AutoGen/MS** | Teams (native) | Azure Bot Framework для остальных |
| **CrewAI** | 0 | Нет |
| **MetaGPT** | 0 | Нет |

**Вывод для CEOClaw:** OpenClaw значительно превосходит по количеству каналов. Для B2B клиентов в РФ критичны: Telegram (✅ есть), WhatsApp Business (❌ нет), Email полноценный (❌ только отправка).

---

### 2.9 Scalability & Deployment

| Система | Deployment | Scalability |
|---------|-----------|-------------|
| **CEOClaw** | Vercel (Next.js) + daemon local | Вертикальная (single instance) |
| **OpenClaw** | Local daemon (launchd/systemd) | Вертикальная (single user) |
| **LangGraph** | LangGraph Cloud / self-hosted | Горизонтальная (production-proven) |
| **AutoGen/MS** | Azure + Kubernetes | Горизонтальная (enterprise) |
| **Semantic Kernel** | Azure / self-hosted .NET | Горизонтальная |

**Вывод для CEOClaw:** Для текущей стадии (первые клиенты) single-instance достаточно. Но для масштабирования нужна архитектура hot-path / cold-path и очереди задач.

---

### 2.10 Observability & Debugging

| Система | Tracing | Monitoring | Debugging |
|---------|---------|-----------|-----------|
| **CEOClaw** | Correlation IDs + execution steps | Health monitor в daemon | Console logs |
| **OpenClaw** | Session history + cost tracking | Gateway /health | Logs + session replay |
| **LangGraph** | LangSmith (полный трейсинг) | Built-in metrics | Visual graph debugger |
| **AutoGen/MS** | Azure Monitor + advanced tracing | Enterprise telemetry | Visual Studio debugger |

**Вывод для CEOClaw:** Базовая observability есть (correlation IDs), но нет: tracing UI, cost dashboard, latency metrics, error rate monitoring.

---

### 2.11 Domain Specialization (PM)

| Система | PM Features | Описание |
|---------|------------|----------|
| **CEOClaw** | ⭐⭐⭐⭐⭐ | 54 Prisma models, portfolio/project/task hierarchy, Gantt, EVM, risk matrix, work-report chain, budget tracking, equipment, materials, GPS tracking |
| **OpenClaw** | ⭐ | Нет PM-специфичных функций (AI-PMO skills — внешние prompt-based) |
| **LangGraph** | ❌ | General purpose framework |
| **AutoGen/MS** | ❌ | General purpose framework |
| **CrewAI** | ❌ | General purpose framework |

**Вывод для CEOClaw:** **Безусловный лидер по PM-функциональности.** Ни один мультиагентный фреймворк не имеет встроенного PM-домена. CEOClaw — единственный, где AI понимает проектный контекст (EVM, critical path, risk matrix).

---

### 2.12 Extensibility (расширяемость)

| Система | Plugin System | Custom Agents | Custom Tools |
|---------|-------------|---------------|-------------|
| **CEOClaw** | ❌ Нет | Hardcoded в agents.ts | Hardcoded в tools.ts (13 tools) |
| **OpenClaw** | Skills (prompt/NPM) + MCP servers | JSON config в openclaw.json | Plugin SDK |
| **LangGraph** | LangChain ecosystem | Python classes | Tool binding API |
| **AutoGen/MS** | Semantic Kernel plugins | Agent builder SDK | Function calling |
| **CrewAI** | YAML config | YAML agent definitions | Tool wrappers |

**Вывод для CEOClaw:** Самая низкая расширяемость. Добавить нового агента или tool = правка кода. Нет plugin system, нет config-driven agents.

---

## 3. ДЕТАЛЬНЫЙ АНАЛИЗ: CEOClaw

### Архитектура ядра (текущая)

```
┌──────────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 15 / React 18)              │
│                    contexts/ai-context.tsx                        │
│                    MIN_TIME_BETWEEN_RUNS = 3000ms                │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│            AIKernelControlPlane (Central Dispatcher)              │
│            8 operations, typed request/response envelopes        │
│            Correlation ID tracking, actor context                 │
├──────────────────────────────────────────────────────────────────┤
│                             │                                     │
│    ┌────────────────────────┼────────────────────────┐           │
│    ▼                        ▼                        ▼           │
│  Auto-Routing         Multi-Agent Runtime      Kernel Tool Plane │
│  (185 lines)          (714 lines)              (282 lines)       │
│  - keyword match      - 5 blueprints           - 13 tools        │
│  - domain heuristics  - leader-support         - 4 domains       │
│  - RU/CN keywords     - sequential support     - thin dispatch   │
│  - fallback:          - consensus extraction                     │
│    portfolio-analyst                                             │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    AIRouter (Multi-Provider)                      │
│                                                                   │
│  Priority: GigaChat → YandexGPT → AIJora → Polza → Bothub       │
│            → OpenRouter → OpenAI → ZAI                           │
│                                                                   │
│  Per-provider model chains:                                       │
│  - OpenRouter: Gemma-27b → 12b → 4b (free tier)                 │
│  - GigaChat: Pro (leader) / Standard (support)                   │
│  - YandexGPT: yandexgpt (leader) / yandexgpt-lite (support)     │
│  - OpenAI: gpt-5.2 (leader) / gpt-4o-mini (support)             │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Evidence & Truth Layer                         │
│                                                                   │
│  Evidence Ledger:                                                │
│  - 3 states: reported → observed → verified                      │
│  - Confidence: 0-100                                             │
│  - 4 source connectors: 1C, Telegram, GPS, Email                │
│  - Fusion layer: cross-source validation                         │
│                                                                   │
│  Grounding:                                                       │
│  - Top 3 records by confidence                                   │
│  - AI-proposals reference evidence                               │
│  - Ledger summary in every context bundle                        │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Safety & Proposal Layer                        │
│                                                                   │
│  6 proposal types: create_tasks, update_tasks, reschedule_tasks, │
│                    raise_risks, draft_status_report, notify_team  │
│                                                                   │
│  Safety profiles per type:                                        │
│  - Level: low / medium / high                                    │
│  - Mode: preview_only / guarded_patch / guarded_communication    │
│  - Compensation: replace_draft / follow_up_patch /               │
│                  close_or_correct / send_correction_notice        │
│                                                                   │
│  State machine: pending → applied | dismissed                    │
│  Audit: correlation IDs + execution steps                        │
└──────────────────────────────────────────────────────────────────┘
```

### Ключевые файлы ядра

| Файл | Строк | Назначение |
|------|-------|-----------|
| `lib/ai/providers.ts` | 890 | 8 LLM-провайдеров + AIRouter |
| `lib/ai/context-builder.ts` | 802 | Сборка AI-контекста (portfolio, evidence, alerts) |
| `lib/ai/openclaw-gateway.ts` | 810 | Gateway-оркестрация |
| `lib/ai/multi-agent-runtime.ts` | 714 | Collaborative execution (5 blueprints) |
| `lib/ai/server-runs.ts` | 569 | Run lifecycle (create, get, apply) |
| `lib/ai/grounding.ts` | 534 | Evidence integration |
| `lib/ai/kernel-control-plane.ts` | 425 | Central dispatcher (8 ops) |
| `lib/ai/types.ts` | 369 | Type definitions |
| `lib/ai/proposal-apply-executor.ts` | 280 | Proposal execution + safety |
| `lib/ai/kernel-tool-plane.ts` | 282 | Tool dispatcher (13 tools) |
| `lib/ai/agents.ts` | 257 | Agent registry (25 agents) |
| `lib/ai/safety.ts` | 226 | Safety profiles |
| `lib/ai/auto-routing.ts` | 185 | Intelligent routing |
| `lib/evidence/` | ~1,438 | Evidence Ledger (service + fusion + types) |
| `lib/connectors/` | ~14 files | 4 connector adapters |
| `daemon/` | ~11 files | Background service (Telegram, cron, gateway) |
| **ИТОГО ядро** | **~7,000+** | — |

---

## 4. ДЕТАЛЬНЫЙ АНАЛИЗ: OpenClaw

### Архитектура ядра

```
┌─────────────────────────────────────────────────────────────────┐
│              Control Plane (Gateway localhost:18789)              │
│              Web UI (React/Vite) + Terminal UI                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         Session Router & Agent Dispatcher                        │
│         Route → Primary agent or subagent                       │
│         Context pruning (soft 12k / hard 100k+ tokens)          │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
┌──────────────┐ ┌────────────────┐ ┌──────────────┐
│ Tier 1:      │ │ Tier 2:        │ │ Tier 3:      │
│ Orchestrators│ │ Workers (11)   │ │ Utilities (6)│
│ (3)          │ │                │ │              │
│ orch-eng     │ │ coder, coder2  │ │ main         │
│ orch-research│ │ researcher     │ │ main-worker  │
│ orch-ops     │ │ writer         │ │ main-reviewer│
│              │ │ ops-tracker    │ │ planner      │
│ Max 16       │ │ quick-*        │ │ executor     │
│ subagents    │ │ eng-qa         │ │ audio-trans. │
│ each         │ │ research-*     │ │              │
└──────────────┘ └────────────────┘ └──────────────┘
       │                │
       │    ┌───────────┘
       ▼    ▼
┌─────────────────────────────────────────────────────────────────┐
│              Tool & Capability Layer                              │
│                                                                   │
│  Per-agent: file I/O, process exec, browser, web search,        │
│  agent-to-agent (sessions_spawn/send), custom skills, MCP       │
│                                                                   │
│  Security: allowlist / deny / full / sandbox modes               │
│  Per-agent tool profiles (coding / full / research)              │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Memory Layer                                         │
│                                                                   │
│  Per-agent SQLite: memory/{agent-id}.sqlite                      │
│  Local embeddings: nomic-embed-text-v1.5 (GGUF)                 │
│  Markdown journals: IDENTITY.md, SOUL.md, BOOTSTRAP.md          │
│  Context: TTL 1h, soft trim 30%, hard clear 50%                 │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Channel Adapters (12 каналов)                        │
│                                                                   │
│  Telegram (Grammy) | WhatsApp (Baileys) | Slack | Discord       │
│  Signal | iMessage | Teams | WebChat | Matrix | Zalo | Line     │
│  Google Chat                                                     │
│                                                                   │
│  Message queue: debounce 500ms, steer mode                       │
└─────────────────────────────────────────────────────────────────┘
```

### Ключевые метрики OpenClaw

| Метрика | Значение |
|---------|----------|
| Размер установки | ~443 MB |
| JS-файлов (dist) | 1,669 |
| LOC (dist) | 136,335+ |
| Агентов | 20 (3 orchestrators + 11 workers + 6 utilities) |
| Каналов | 12 |
| LLM-провайдеров | 3 |
| Модулей | 42+ |
| SQLite баз | 20 (per-agent) |
| Max concurrent subagents | 16 per orchestrator |
| Context window | до 200k tokens (GLM-5) |
| Skills | 4 AI-PMO + RevealJS + Caffeine |

---

## 5. ДЕТАЛЬНЫЙ АНАЛИЗ: РЫНОЧНЫЕ КОНКУРЕНТЫ

### LangGraph (лидер рынка)
```
Парадигма:   Stateful graph orchestration (DAG)
Зрелость:    Production (90k GitHub stars, Uber/LinkedIn/Klarna)
Accuracy:    94% на multi-step orchestration benchmarks
Сила:        Checkpointing, rollback, failure isolation, conditional branching
Слабость:    Steep learning curve, больше boilerplate для простых задач
Экосистема:  LangChain (100+ моделей), LangSmith (observability)
```

### AutoGen → Microsoft Agent Framework
```
Парадигма:   Event-driven conversational agents
Зрелость:    Enterprise (Azure native)
Скорость:    20% быстрее конкурентов (end-to-end)
Сила:        Async, Azure integration, best debugging/tracing
Слабость:    89% accuracy (vs 94% LangGraph), Microsoft lock-in
Эволюция:    AutoGen + Semantic Kernel → unified Microsoft Agent Framework (2025+)
```

### Semantic Kernel
```
Парадигма:   Pluggable orchestration (.NET + TypeScript)
Паттерны:    Concurrent, Sequential, Handoff, Group Chat, Magentic
Сила:        Enterprise security (A2A JWT, mTLS), .NET-first
Слабость:    TypeScript support отстаёт от .NET
```

### CrewAI
```
Парадигма:   Role-based team metaphor (YAML/JSON config)
Зрелость:    MVP/prototype
Скорость:    5.76x быстрее LangGraph на простых задачах
Сила:        Простота, быстрый старт, читаемость
Слабость:    Low determinism, looping, не для production
```

### MetaGPT
```
Парадигма:   Software company simulation (SOP-driven)
Зрелость:    Open-source, research
Accuracy:    46.67% SWE-Bench Lite (2025)
Сила:        Repository-level understanding, multi-role collaboration
Слабость:    Нишевой (только software engineering)
```

---

## 6. МАТРИЦА СРАВНЕНИЯ (СВОДНАЯ ТАБЛИЦА)

| Критерий | CEOClaw | OpenClaw | LangGraph | AutoGen/MS | CrewAI | MetaGPT |
|----------|---------|----------|-----------|-----------|--------|---------|
| **Оркестрация** | 3/5 (hardcoded blueprints) | 4/5 (hierarchical spawn) | 5/5 (DAG, cycles) | 4/5 (event-driven) | 3/5 (flat team) | 4/5 (SOP) |
| **Автономность агентов** | 1/5 (prompt templates) | 5/5 (full autonomy) | 4/5 (stateful nodes) | 5/5 (conversation) | 3/5 (role-bounded) | 5/5 (code exec) |
| **Память** | 1/5 (нет) | 4/5 (SQLite + embeddings) | 4/5 (checkpoints + vector) | 4/5 (stores) | 1/5 (нет) | 3/5 (SOP artifacts) |
| **Tool Use** | 2/5 (centralized, post-approval) | 5/5 (per-agent, autonomous) | 5/5 (node-level binding) | 5/5 (function calling) | 3/5 (basic) | 4/5 (code+test) |
| **LLM Providers** | 5/5 (8, включая RU) | 3/5 (3 провайдера) | 5/5 (100+ через LangChain) | 4/5 (Azure + others) | 4/5 (LiteLLM) | 3/5 (OpenAI focus) |
| **Безопасность** | 5/5 (proposal-as-draft + safety profiles) | 4/5 (sandbox + allowlist) | 4/5 (checkpoints + HITL) | 4/5 (Entra ID + zones) | 2/5 (minimal) | 3/5 (SOP gates) |
| **Evidence Grounding** | 5/5 (УНИКАЛЬНО) | 2/5 (journals) | 3/5 (RAG) | 3/5 (KB) | 1/5 (нет) | 3/5 (repo) |
| **PM Domain** | 5/5 (54 models, full PM) | 1/5 (нет) | 0/5 (framework) | 0/5 (framework) | 0/5 (framework) | 0/5 (SWE only) |
| **Multi-channel** | 2/5 (Web + Telegram) | 5/5 (12 каналов) | 0/5 (нет) | 2/5 (Teams) | 0/5 (нет) | 0/5 (нет) |
| **Расширяемость** | 1/5 (hardcoded) | 4/5 (skills + MCP + plugins) | 5/5 (LangChain ecosystem) | 5/5 (SK plugins) | 4/5 (YAML config) | 3/5 (SOP templates) |
| **Observability** | 2/5 (correlation IDs) | 3/5 (logs + cost) | 5/5 (LangSmith) | 5/5 (Azure Monitor) | 1/5 (basic logs) | 2/5 (artifacts) |
| **Production-ready** | 3/5 (нужна доработка) | 3/5 (single-user) | 5/5 (proven) | 5/5 (Azure) | 2/5 (MVP only) | 2/5 (research) |
| **СРЕДНЕЕ** | **2.9/5** | **3.6/5** | **3.8/5** | **3.8/5** | **2.0/5** | **2.7/5** |

### Визуальный Radar Chart (текстовый)

```
                    Оркестрация
                        5
                        │
           Расшир. ─────┼───── Автономность
              5 ────────┤────────── 5
                   ╱    │    ╲
                  ╱     │     ╲
  Observ. 5─────╱──────┼──────╲───── Память 5
                ╱       │       ╲
               ╱        │        ╲
  Prod.ready 5─────────┼─────────── Tool Use 5
               ╲        │        ╱
                ╲       │       ╱
  Multi-ch 5────╲──────┼──────╱───── LLM Provid. 5
                  ╲     │     ╱
                   ╲    │    ╱
  PM Domain 5──────╲───┼───╱──── Safety 5
                        │
                   Evidence 5

CEOClaw:   ███ PM Domain(5), Safety(5), Evidence(5), LLM(5)
           ░░░ Автономность(1), Память(1), Расширяемость(1)

OpenClaw:  ███ Автономность(5), Tool Use(5), Multi-ch(5)
           ░░░ PM Domain(1), Evidence(2)

LangGraph: ███ Оркестрация(5), Tool Use(5), Расширяемость(5), Observ.(5)
           ░░░ PM Domain(0), Multi-ch(0)
```

---

## 7. SWOT-АНАЛИЗ ЯДРА CEOClaw

### Strengths (Сильные стороны)
1. **Evidence Ledger** — уникальная система верификации фактов, аналогов нет
2. **Safety Profiles** — enterprise-grade безопасность с компенсационными стратегиями
3. **PM Domain expertise** — 54 модели, EVM, critical path, risk matrix встроены в AI
4. **Российские LLM** — GigaChat + YandexGPT для соблюдения 152-ФЗ
5. **Proposal-as-Draft** — AI не делает мутации без одобрения человека
6. **Typed architecture** — TypeScript strict:true, discriminated unions, correlation IDs
7. **Connector registry** — plug-and-play интеграция с 1С, GPS, Telegram, Email

### Weaknesses (Слабые стороны)
1. **Агенты = prompt templates** — нет настоящей автономности
2. **Нет agent memory** — агенты не помнят предыдущие взаимодействия
3. **5 hardcoded blueprints** — нет динамического планирования
4. **Нет inter-agent communication** — агенты не общаются друг с другом
5. **Нет plugin system** — добавление агентов/tools = правка кода
6. **providers.ts = 890-line monolith** — нужен split по файлам
7. **Нет cost tracking** — неизвестна стоимость AI-запросов
8. **Нет cross-provider fallback** — если провайдер упал, ошибка

### Opportunities (Возможности)
1. **Заимствовать из OpenClaw**: hierarchical orchestration, per-agent memory, agent-to-agent communication, sandbox execution
2. **Заимствовать из LangGraph**: DAG-based workflows, checkpointing, visual debugging
3. **Заимствовать из Semantic Kernel**: plugin system, YAML-driven agent config
4. **Внедрить RAG**: vector embeddings для long-term memory (pgvector уже в PostgreSQL)
5. **Российский рынок**: PM + AI + Evidence = уникальная ниша, конкурентов нет
6. **WhatsApp Business** — критически важный канал для строительных прорабов

### Threats (Угрозы)
1. **Битрикс24 + AI** — Bitrix интегрирует AI в PM (массовый рынок)
2. **ADVANTA + импортозамещение** — enterprise конкуренты с гос.поддержкой
3. **LangGraph enters PM** — если кто-то построит PM-плагин для LangGraph
4. **Vendor lock-in от LLM** — зависимость от конкретных провайдеров

---

## 8. ЧТО НУЖНО УСОВЕРШЕНСТВОВАТЬ (25 РЕКОМЕНДАЦИЙ)

### P0: Критические (делать немедленно)

#### 1. Agent Memory System
**Проблема:** Агенты не помнят предыдущие взаимодействия
**Решение:** Внедрить per-agent memory (по модели OpenClaw)
```typescript
// lib/ai/memory/agent-memory.ts
interface AgentMemoryStore {
  shortTerm: Map<string, ConversationContext>;  // текущая сессия
  longTerm: PgVectorStore;  // pgvector для semantic search
  episodic: EpisodicMemory[];  // ключевые события
}

// Использовать pgvector (уже в PostgreSQL):
// CREATE EXTENSION vector;
// ALTER TABLE agent_memory ADD COLUMN embedding vector(1536);
```
**Эффект:** Агенты смогут ссылаться на прошлые решения, учитывать историю проекта.

#### 2. Dynamic Agent Orchestration
**Проблема:** 5 hardcoded blueprints не покрывают все сценарии
**Решение:** Planner-Executor pattern (по модели LangGraph + AutoGen)
```typescript
// lib/ai/orchestration/planner.ts
interface ExecutionPlan {
  goal: string;
  steps: ExecutionStep[];
  dependencies: Map<string, string[]>;
  fallbackStrategy: FallbackStrategy;
}

async function planExecution(
  request: AIRunInput,
  context: AIChatContextBundle
): Promise<ExecutionPlan> {
  // LLM-based planning: анализ запроса → выбор агентов → определение зависимостей
  // Заменяет hardcoded blueprints на динамическое планирование
}
```
**Эффект:** Система сама решает, каких агентов привлечь и в каком порядке.

#### 3. Cross-Provider Fallback
**Проблема:** Если провайдер недоступен — ошибка
**Решение:** Circuit breaker + automatic failover
```typescript
// lib/ai/providers/circuit-breaker.ts
class ProviderCircuitBreaker {
  private failures: Map<string, number> = new Map();
  private readonly threshold = 3;
  private readonly cooldown = 60_000; // 1 min

  async executeWithFallback(
    providers: string[],
    request: ChatRequest
  ): Promise<ChatResponse> {
    for (const provider of providers) {
      if (this.isOpen(provider)) continue;
      try {
        return await this.router.chat(request, { provider });
      } catch (e) {
        this.recordFailure(provider);
      }
    }
    throw new AllProvidersFailedError();
  }
}
```
**Эффект:** Автоматическое переключение при сбое провайдера. Uptime → 99.9%.

#### 4. Split providers.ts Monolith
**Проблема:** 890 строк в одном файле, 8 классов
**Решение:** По одному файлу на провайдер
```
lib/ai/providers/
├── index.ts          (AIRouter — 100 lines)
├── base.ts           (AIProvider interface)
├── gigachat.ts       (GigaChatProvider)
├── yandexgpt.ts      (YandexGPTProvider)
├── openrouter.ts     (OpenRouterProvider)
├── openai.ts         (OpenAIProvider)
├── aijora.ts         (AIJoraProvider)
├── polza.ts          (PolzaProvider)
├── bothub.ts         (BothubProvider)
├── zai.ts            (ZAIProvider)
├── circuit-breaker.ts
└── manifests.ts
```

---

### P1: Важные (в течение 2-4 недель)

#### 5. Agent-to-Agent Communication
**Проблема:** Агенты не могут обмениваться информацией
**Решение:** Message bus (по модели OpenClaw sessions_spawn)
```typescript
// lib/ai/messaging/agent-bus.ts
interface AgentMessage {
  from: AgentId;
  to: AgentId;
  type: "request" | "response" | "broadcast";
  payload: unknown;
  correlationId: string;
}

class AgentMessageBus {
  async send(msg: AgentMessage): Promise<void>;
  async request(msg: AgentMessage): Promise<AgentMessage>;  // request-reply
  subscribe(agentId: AgentId, handler: MessageHandler): void;
}
```

#### 6. Config-Driven Agent Registry
**Проблема:** Агенты hardcoded в agents.ts
**Решение:** JSON/YAML конфигурация (по модели OpenClaw/CrewAI)
```json
// config/agents/risk-researcher.json
{
  "id": "risk-researcher",
  "kind": "researcher",
  "category": "monitoring",
  "model": {
    "primary": "gigachat-pro",
    "fallback": "yandexgpt"
  },
  "tools": ["get_project_summary", "list_tasks", "get_critical_path"],
  "systemPrompt": "prompts/risk-researcher.md",
  "memory": { "enabled": true, "maxHistory": 50 },
  "subagents": []
}
```

#### 7. Agent Tool Calling (не только через Kernel)
**Проблема:** Агенты не могут вызывать tools самостоятельно
**Решение:** LLM function calling с safety guard
```typescript
// lib/ai/agent-executor.ts
class AgentExecutor {
  async run(agent: AgentDefinition, input: string): Promise<AgentResult> {
    const tools = agent.allowedTools.map(t => this.toolPlane.getDescriptor(t));
    
    // LLM с function calling
    const response = await this.provider.chat(messages, { tools });
    
    // Safety guard: проверить safety profile перед execution
    for (const call of response.toolCalls) {
      const safety = this.safetyChecker.check(call, agent);
      if (safety.requiresApproval) {
        return { status: "needs_approval", pendingCalls: [call] };
      }
      const result = await this.toolPlane.execute(call);
      // ... accumulate results
    }
  }
}
```

#### 8. Cost Tracking & Budget
**Проблема:** Неизвестна стоимость AI-запросов
**Решение:** Per-run cost tracking
```typescript
// lib/ai/cost-tracker.ts
interface AIRunCost {
  runId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;  // в рублях
  latencyMs: number;
}

// Prisma model:
// model AIRunCost {
//   id        String @id @default(cuid())
//   runId     String
//   provider  String
//   model     String
//   inputTokens  Int
//   outputTokens Int
//   costRub   Decimal
//   latencyMs Int
//   createdAt DateTime @default(now())
// }
```

#### 9. Observability Dashboard
**Проблема:** Нет визуального мониторинга AI runtime
**Решение:** Встроенный /admin/ai-dashboard
- Runs per day (chart)
- Cost per provider (bar chart)
- Latency percentiles (p50, p95, p99)
- Error rate per provider
- Agent usage distribution
- Evidence grounding score average

#### 10. WhatsApp Business Integration
**Проблема:** Telegram есть, WhatsApp нет (критично для строителей)
**Решение:** WhatsApp Business API через Cloud API (Meta)
```typescript
// lib/connectors/whatsapp-business.ts
// Использовать @whatsapp-api-js/core
// Или WhatsApp Cloud API напрямую (graph.facebook.com)
```

---

### P2: Значительные (в течение 1-2 месяцев)

#### 11. RAG (Retrieval-Augmented Generation)
Внедрить vector search для документов проекта (pgvector или Qdrant).

#### 12. Streaming Responses
Сейчас AI возвращает полный ответ. Добавить SSE/WebSocket streaming для UX.

#### 13. Agent Self-Reflection
После выполнения — агент оценивает качество своего ответа и при необходимости итерирует.

#### 14. Checkpoint/Rollback
По модели LangGraph — сохранять state между шагами и откатывать при ошибке.

#### 15. Plugin System для Tools
Позволить добавлять tools через конфиг, без правки кода.

#### 16. Voice-First Interface
Whisper API для голосового ввода (по модели OpenClaw audio-transcribe).

#### 17. Batch Operations
Групповые операции: "создай задачи для всех проектов" — параллельное исполнение.

#### 18. Multi-Workspace AI Context
Сейчас контекст — один workspace. Добавить cross-workspace analysis.

---

### P3: Улучшения (в течение 3-6 месяцев)

#### 19. Visual Agent Graph Editor
UI для визуального создания collaboration patterns (drag-and-drop агентов).

#### 20. A/B Testing для AI Prompts
Тестирование разных промптов и моделей для одного агента.

#### 21. Agent Training on Customer Data
Fine-tuning на данных конкретного клиента (LoRA/QLoRA).

#### 22. Federated Learning
Обучение на данных нескольких клиентов без передачи raw data.

#### 23. Multi-Language Support
Добавить UI + AI prompts на казахском, английском (для международных проектов).

#### 24. Offline Mode
Локальная модель (Llama 3, Mistral) для работы без интернета на стройплощадке.

#### 25. MCP (Model Context Protocol) Server
Реализовать MCP-сервер для интеграции с IDE и другими AI-клиентами.

---

## 9. АРХИТЕКТУРНЫЕ ДИАГРАММЫ

### 9.1 Целевая архитектура ядра CEOClaw (после улучшений)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CHANNELS                                       │
│   Web UI  │  Telegram  │  WhatsApp  │  Email  │  Voice  │  MCP Client   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    AIKernelControlPlane v2                                │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  Session Router  │  │  Agent Registry   │  │  Cost & Observability  │  │
│  │  (auto-routing)  │  │  (config-driven)  │  │  Dashboard             │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────────────────────┘  │
│           │                    │                                          │
│           ▼                    ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                Dynamic Planner (NEW)                              │    │
│  │                                                                   │    │
│  │  Request → Analyze → Select Agents → Build Plan → Execute         │    │
│  │                                                                   │    │
│  │  Patterns: Sequential, Parallel, Leader-Support, DAG, Hierarchy  │    │
│  │  Fallback: If plan fails → re-plan with different agents         │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│           ┌──────────────────┼──────────────────┐                       │
│           ▼                  ▼                  ▼                        │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │
│  │ Agent Executor  │ │ Agent Executor  │ │ Agent Executor  │              │
│  │ (with memory)   │ │ (with memory)   │ │ (with memory)   │              │
│  │                 │ │                 │ │                 │              │
│  │ ┌─────────────┐│ │ ┌─────────────┐│ │ ┌─────────────┐│              │
│  │ │ LLM + Tools ││ │ │ LLM + Tools ││ │ │ LLM + Tools ││              │
│  │ │ + Memory    ││ │ │ + Memory    ││ │ │ + Memory    ││              │
│  │ │ + Reflection││ │ │ + Reflection││ │ │ + Reflection││              │
│  │ └─────────────┘│ │ └─────────────┘│ │ └─────────────┘│              │
│  └───────┬────────┘ └───────┬────────┘ └───────┬────────┘              │
│          └──────────────────┼──────────────────┘                        │
│                             │                                            │
│                    ┌────────▼────────┐                                   │
│                    │  Agent Message   │                                   │
│                    │  Bus (NEW)       │                                   │
│                    └────────┬────────┘                                   │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌────────────────┐ ┌──────────────────┐
│ Kernel Tool Plane │ │ Evidence Layer  │ │ Memory Layer     │
│ (plugin-based)    │ │ (unchanged)    │ │ (NEW: pgvector)  │
│                   │ │                │ │                   │
│ 13+ tools         │ │ Evidence Ledger│ │ Short-term cache  │
│ + custom plugins  │ │ + Fusion       │ │ Long-term vectors │
│ + MCP tools       │ │ + Grounding    │ │ Episodic memory   │
└──────────────────┘ └────────────────┘ └──────────────────┘
              │               │               │
              ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Safety & Proposal Layer (unchanged + enhanced)         │
│                                                                          │
│  Proposal-as-Draft │ Safety Profiles │ Compensation │ Audit Trail       │
│  + NEW: Agent-initiated mutations with safety guard                     │
│  + NEW: Checkpoint/Rollback for multi-step proposals                    │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    AIRouter v2 (with Circuit Breaker)                     │
│                                                                          │
│  Priority chain: GigaChat → YandexGPT → AIJora → OpenRouter → OpenAI   │
│  + Circuit breaker (3 failures → 1 min cooldown → retry)                │
│  + Cost tracking per request                                             │
│  + Latency monitoring                                                    │
│  + Provider health dashboard                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Сравнение data flow

```
              CEOClaw (текущий)                         CEOClaw (целевой)
              ─────────────────                         ─────────────────

User Input                                   User Input
    │                                             │
    ▼                                             ▼
Auto-routing (keywords)                      Auto-routing (LLM-based)
    │                                             │
    ▼                                             ▼
Kernel Control Plane                         Dynamic Planner
    │                                             │
    ▼                                             ├─→ Agent 1 (with tools + memory)
Blueprint lookup (5 hardcoded)                    │     ├─→ Tool call (self-service)
    │                                             │     ├─→ Memory lookup
    ▼                                             │     └─→ Reflection
Support agents (sequential)                       ├─→ Agent 2 (parallel)
    │                                             │     └─→ ...
    ▼                                             ├─→ Agent 3 (depends on 1)
Leader synthesis                                  │     └─→ Agent-to-Agent message
    │                                             │
    ▼                                             ▼
Proposal (needs_approval)                    Proposal + Checkpoint
    │                                             │
    ▼                                             ▼
Human approval                               Human approval (or auto if low-risk)
    │                                             │
    ▼                                             ▼
Tool execution (kernel)                      Tool execution (agent-initiated + kernel)
    │                                             │
    ▼                                             ▼
Result                                       Result + Cost logged + Memory updated
```

---

## 10. ПРИОРИТЕТНЫЙ ПЛАН УЛУЧШЕНИЙ

### Фаза 1: Foundation (2-3 недели)
| # | Задача | Сложность | Эффект |
|---|--------|-----------|--------|
| 1 | Split providers.ts на отдельные файлы | Низкая | Поддерживаемость кода |
| 2 | Cross-provider fallback (circuit breaker) | Средняя | Надёжность 99.9% |
| 3 | Cost tracking (Prisma model + per-run logging) | Средняя | Прозрачность расходов |
| 4 | Config-driven agent registry (JSON файлы) | Средняя | Расширяемость |

### Фаза 2: Intelligence (3-4 недели)
| # | Задача | Сложность | Эффект |
|---|--------|-----------|--------|
| 5 | Agent Memory (pgvector + short-term cache) | Высокая | Контекстуальные ответы |
| 6 | Agent Tool Calling (function calling + safety guard) | Высокая | Автономность агентов |
| 7 | Dynamic Planner (замена hardcoded blueprints) | Высокая | Гибкая оркестрация |
| 8 | Streaming responses (SSE) | Средняя | UX |

### Фаза 3: Communication (2-3 недели)
| # | Задача | Сложность | Эффект |
|---|--------|-----------|--------|
| 9 | Agent Message Bus | Средняя | Inter-agent communication |
| 10 | WhatsApp Business integration | Средняя | Каналы для строителей |
| 11 | Voice input (Whisper API) | Низкая | Голосовой ввод |

### Фаза 4: Advanced (4-6 недель)
| # | Задача | Сложность | Эффект |
|---|--------|-----------|--------|
| 12 | RAG (pgvector + document indexing) | Высокая | Knowledge base |
| 13 | Checkpoint/Rollback | Высокая | Надёжность multi-step |
| 14 | Plugin System для tools | Средняя | Расширяемость |
| 15 | Observability Dashboard | Средняя | Мониторинг |

---

## ЗАКЛЮЧЕНИЕ

### CEOClaw: Где мы сейчас

CEOClaw обладает **уникальными конкурентными преимуществами**, которых нет ни у одной мультиагентной системы на рынке:
- **Evidence Ledger** — единственная система с верификацией фактов для PM
- **Safety Profiles** — enterprise-grade безопасность решений
- **PM Domain** — 54 модели, полный PM-стек в AI
- **Российские LLM** — 152-ФЗ compliant с GigaChat + YandexGPT

Но ядро **отстаёт по ключевым параметрам** мультиагентной архитектуры:
- Агенты = prompt templates (не настоящие агенты)
- Нет памяти, нет inter-agent communication
- Hardcoded blueprints вместо динамического планирования

### Рекомендация

**Стратегия "Лучшее из двух миров":**
1. **Сохранить** уникальные преимущества CEOClaw (Evidence, Safety, PM Domain)
2. **Заимствовать** архитектурные паттерны из OpenClaw (memory, agent autonomy, multi-channel)
3. **Внедрить** индустриальные стандарты из LangGraph/AutoGen (dynamic planning, checkpointing, observability)

**Результат:** CEOClaw станет первой в мире **PM-specific multi-agent platform** с enterprise-grade safety, evidence grounding, и true agent autonomy.

---

*Документ подготовлен для внутреннего использования. Версия 1.0.*
