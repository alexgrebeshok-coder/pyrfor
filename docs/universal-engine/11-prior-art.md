# 11 — Prior Art Map

> ← [10 — Roadmap](./10-roadmap-milestones.md) · далее → [12 — Risks & Decisions](./12-risks-and-decisions.md)

> Краткая выжимка. Полный отчёт исследования (с цитатами и URL) — в [agent-discussions/prior-art.md](./agent-discussions/prior-art.md).

---

## 11.1 Что и откуда мы заимствуем (cheat sheet)

| Источник | Идея | Где применяем |
|---|---|---|
| **Voyager** (Minecraft) | Skill library с автокурсом + retrieval-augmented tool reuse | ToolRegistry + Procedural Memory |
| **AlphaCodium** | Flow engineering: spec → tests → impl → iterate | ToolForge: manifest+tests перед impl |
| **Reflexion / Self-Refine** | Verbal reflection между попытками | Bounded SelfHealLoop с failure_trace |
| **OpenHands / SWE-agent** | Дисциплинированный action space | `ISandboxExecutor` strict interface |
| **Devin** | End-to-end автономный агент | Full lifecycle UniversalEngineOrchestrator |
| **MetaGPT** | SOPs как контракты ролей | PlanGraph node `kind` contracts + agent contracts |
| **AutoGen / CrewAI** | Multi-agent оркестрация | Многоагентная топология (но через PlanGraph, не через chat) |
| **LangGraph** | Graph-based agent flows | Уже имеем `DurableDag` — добавляем phase-boundary snapshots |
| **Temporal / Restate / Inngest** | Durable execution + resume | `RunLedger` snapshots + re-hydration из EventLedger |
| **Toolformer / Gorilla / ToolLLM** | Learned tool selection | Procedural memory → подсказки Planner |
| **MCP (Model Context Protocol)** | Стандарт для tool-протокола | Первоклассный `mcp_tool` ToolKind в registry |
| **Constitutional AI / Debate** | Independent critique | Verifier ensemble + family diversity + meta-verification |
| **MemGPT / Letta** | Paged memory с working set | MemoryFacade с per-agent read scopes |
| **Mem0** | Hybrid vector+relational | Backing для semantic memory |
| **E2B / Daytona / Modal / Riza** | Managed sandboxes | SandboxExecutor backend interface — позволит свопнуть на managed |
| **Firecracker / gVisor / Wasmtime** | Изоляция исполнения | Sandbox tier'ы |
| **Toolforge паттерн** (CRADLE, OpenAI fn-gen) | LLM генерирует код инструмента | ToolForge с обязательным manifest-first порядком |
| **AutoGPT / BabyAGI** | Свободный agent loop | **Что НЕ делаем** — мы строим governed lifecycle, а не free-form loop |

---

## 11.2 Что НЕ закрывает существующая экосистема (наша ниша)

> Из исследования prior-art: **никакой существующий стек не закрывает полный цикл «концепция → декомпозиция → tool discovery → tool synthesis → impl → tests → deployment → durable operation»** под единым governance.

Сильные стороны существующих:
- OpenHands / SWE-agent / Devin — сильные code-агенты, но **не универсальные** и **без synthesis инструментов**.
- Voyager — синтез skill'ов, но **только в Minecraft** и без governance.
- AutoGen / CrewAI — мультиагент, но **без durable PlanGraph и без provenance**.
- LangGraph — durable, но **без agent reasoning patterns** out of the box.
- MetaGPT — SOPs, но **жёстко зашитые домены** (компания-метафора).

**Pyrfor Universal Engine** объединяет: governed lifecycle + durable PlanGraph + verifier ensemble + tool synthesis с safety + multi-domain + memory hierarchies.

---

## 11.3 Открытые проблемы 2025–2026, которые мы явно решаем

| Проблема | Наш ответ |
|---|---|
| Verifier collusion (Critic соглашается с Coder) | Family-diversity rule + ≥1 executable verifier + meta-verification |
| Tool synthesis runaway / unsafe code | Manifest-first + static+dynamic taint + sandbox tiers + per-tool budgets + eviction |
| Goal drift / reward hacking | Strategy memory anchored to user-confirmed goals + meta-improvements gated |
| Prompt injection из web research | Injection-scan verifier + evidence quoting + no-net at synthesis |
| Context bloat / infinite consultation | Hard turn budgets per node + deterministic tie-breakers + single source of truth |
| Memory poisoning | Mandatory provenance + source-quality gate + conflict→approval + quarantine |
| Cost explosion | Per-concept/per-phase/per-tool budgets + budget-aware downgrade (но не Verifier) |
| Resume after crash | Phase-boundary snapshots + content-addressed artifacts + PlanGraph re-hydration |

---

## 11.4 Наследие, которое НЕ берём (и почему)

- **«Один монолитный super-agent»** (как в ранних AutoGPT) — не масштабируется, нет audit, нет governance.
- **Скрытые prompts между агентами** (как в некоторых CrewAI sample) — нарушает single-source-of-truth.
- **«LLM-only verifier»** — нарушает verifier independence; всегда требуем executable.
- **Автоматическое self-modification kernel'а** — нарушает rollback; все meta-changes только через gated lifecycle.
- **Жёсткие ролевые SOPs (MetaGPT-style)** — не дают универсальности по доменам; заменяем на конфигурируемые контракты узлов.
