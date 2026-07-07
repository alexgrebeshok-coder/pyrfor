# Pyrfor Universal Engine — Документация v1

> Универсальное автономное мультиагентное ядро: **от концепции пользователя → до полностью рабочего, протестированного, проверенного результата**, с автономным поиском и синтезом инструментов.

**Статус:** План к утверждению. До старта M1 — подтвердить решения в [12-risks-and-decisions.md](./12-risks-and-decisions.md).

**Каталог:** `/Users/demo-user/pyrfor-dev/docs/universal-engine/`

---

## 📚 Структура документации

### Обзор и стратегия
| # | Документ | О чём |
|---|---|---|
| 00 | [Original Vision (v0.1)](./00-original-vision.md) | Исходный документ-видение от Claude (Main) |
| 00.5 | [Algorithmic Governance](./00.5-algorithmic-governance.md) | Пять управляющих алгоритмов, Completion Gates, FeedbackLoopContract, DecisionRecord и context-aware autonomy |
| 01 | [Strategy & Goals](./01-strategy-and-goals.md) | Стратегические цели, принципы, non-goals |
| 02 | [Architecture (high-level + диаграммы)](./02-architecture.md) | Архитектура ядра, маппинг на существующие примитивы Pyrfor |

### Циклы и компоненты
| # | Документ | О чём |
|---|---|---|
| 03 | [Lifecycle](./03-lifecycle.md) | Жизненный цикл с governing algorithms, completion gates, max loops и отдельным шагом LessonsLearned |
| 04 | [Multi-Agent Topology](./04-multi-agent-topology.md) | 10 агентов: контракты, входы/выходы, модельный класс |
| 05 | [Tool Model & ToolForge](./05-tool-model.md) | ToolRegistry, формальный TOC-Gate, PostForge LessonsLearned, лимит v1, sandbox-tier'ы и trust ladder |
| 06 | [Memory & Strategy](./06-memory-and-strategy.md) | Эпизодическая, семантическая, процедурная, стратегическая память |

### Управление и безопасность
| # | Документ | О чём |
|---|---|---|
| 07 | [Safety & Governance](./07-safety-and-governance.md) | Sandbox tiers, Tier Decider, decision/audit artifacts, completion-stop governance, rollback |
| 08 | [Multi-Model Policy](./08-multi-model-policy.md) | Распределение моделей по агентам, failover, бюджеты |

### Поверхности и поставка
| # | Документ | О чём |
|---|---|---|
| 09 | [API · CLI · VS Code](./09-api-cli-vscode.md) | Endpoint'ы шлюза, команды CLI, расширение VS Code |

### План и риски
| # | Документ | О чём |
|---|---|---|
| 10 | [Roadmap & Milestones](./10-roadmap-milestones.md) | 17 milestones с зависимостями (без оценок времени) |
| 11 | [Prior Art Map](./11-prior-art.md) | Что и откуда заимствуем (Voyager, AlphaCodium, MemGPT, …) |
| 12 | [Risks & Open Decisions](./12-risks-and-decisions.md) | Риски + 5 решений к подтверждению перед M1 |

### Источники мультиагентного обсуждения (полные транскрипты)
- [agent-discussions/arch-gpt55.md](./agent-discussions/arch-gpt55.md) — GPT-5.5, ведущая архитектура
- [agent-discussions/arch-opus.md](./agent-discussions/arch-opus.md) — Claude Opus 4.7, альтернатива и анализ безопасности
- [agent-discussions/prior-art.md](./agent-discussions/prior-art.md) — GPT-5.4, исследование prior art (2025–2026)
- [agent-discussions/decomp-sonnet.md](./agent-discussions/decomp-sonnet.md) — Claude Sonnet 4.6, файловая декомпозиция
- [INTERNAL-COUNCIL-ALGORITHMIC-INTEGRATION.md](./INTERNAL-COUNCIL-ALGORITHMIC-INTEGRATION.md) — исходная концепция алгоритмической интеграции

---

## 🧭 С чего начать чтение

1. [00 — Original Vision](./00-original-vision.md) — контекст, который мы расширяем.
2. [00.5 — Algorithmic Governance](./00.5-algorithmic-governance.md) — как пять алгоритмов управляют фазами, бюджетами и самоулучшением.
3. [01 — Strategy & Goals](./01-strategy-and-goals.md) — что мы строим и почему.
4. [02 — Architecture](./02-architecture.md) — общая картина с диаграммами.
5. [03 — Lifecycle](./03-lifecycle.md) — основной цикл «концепция → результат».
6. [10 — Roadmap](./10-roadmap-milestones.md) — порядок реализации.
7. [12 — Risks & Decisions](./12-risks-and-decisions.md) — **подтвердите 5 решений до старта M1**.

---

## ✍️ Ключевые тезисы (TL;DR)

- **Универсальность через контракт, не через домены.** Любая задача проходит через единый PlanGraph (`DurableDag`) с явными входами/выходами/верификаторами.
- **Алгоритмическое управление поверх агентов.** Strategic Planning, Research+ToolCreation, Execution+QualityControl, LessonsLearned и SystemSelfImprovement задают checkpoint'ы, feedback loops и критерии завершения.
- **Completion Gates обязательны.** Consequential шаги не закрываются без required artifacts, явных success criteria и stop-артефакта при провале цикла; budget exhaustion имеет приоритет над `max_loops`.
- **DecisionRecord до выполнения.** Каждый consequential node фиксирует альтернативы, выбранную опцию, evidenceRefs и `nodeHash` в EventLedger ДО старта; иначе TierDecider блокирует.
- **ToolForge жёстко ограничен.** Перед созданием — TOC-Gate из 4 артефактов; после создания — обязательный `PostForge LessonsLearned`; в v1 — не более 2 новых executable non-adapter tools за один `concept_run`.
- **Автономия — это бюджет, а не выключатель.** Per-concept/per-phase/per-tool бюджеты + детерминированный Tier Decider (`autonomous | notify | approve | block`).
- **Инструменты — управляемые граждане.** Capability Manifest → static+dynamic taint → тесты → продвижение только в `sandboxed_experiment` → trust ladder → автоматическая эвикция.
- **Верификация — независимый кворум.** ≥2 верификатора разных семейств моделей + минимум 1 исполняемый.
- **Один источник истины.** PlanGraph + EventLedger + content-addressed ArtifactStore. Никаких приватных каналов между агентами.
- **Самоулучшение — gated и обратимое.** Изменения политик/гардрейлов всегда требуют human-tier approval.
- **Reuse > Extend > Invent.** Расширяем `RunLedger`/`EventLedger`/`DurableDag`/`ArtifactStore`/`VerifierLane`/`ApprovalFlow`/`Guardrails`/`TokenBudgetController` — не строим параллельный стек.
- **Gates enforced, не только декларированы.** `CompletionGateEngine` хучится в orchestrator перед `dag.node.completed`; `governance.gate.checked` / `governance.gate.violation` события идут в EventLedger; `evidence_snapshot_hash` гарантирует идемпотентность и replay; `failed_retryable` ждёт новых артефактов, `failed_terminal` идёт через approval — узел не «бричится» навсегда.
- **Ownership зафиксирован в коде.** M1 runtime-срез: `runtime/universal/completion-gate-engine.ts`, `decision-record-auditor.ts`, `legacy-node-auditor.ts`, `historian.ts`, `universal/memory/*`; `DurableDagOptions.beforeNodeComplete` — первая точка фактического enforcement.
- **Lessons имеют механику, не только запись.** `LessonsLearnedArtifact` → `SingleLoopRecord` / `DoubleLoopRecord` (через Historian); Strategist/ToolForger обязаны выполнять `LessonsQuery` (applicability-first) и фиксировать `LessonDecisionImpact` в `DecisionRecord` — ID без эффекта не считается доказательством. Отклонённые DoubleLoop защищены от thrash через `similarityKey` + требование новой evidence.
- **Memory v2 идёт раньше, но read-only.** M2 добавляет `ConceptStore` и `UniversalMemoryFacade`: approved-only, non-legacy, project-scoped retrieval без auto-promotion и без raw lessons в Planner.
- **Legacy grandfathering — миграционная мера, не дыра.** Eligibility привязана к git-tagged `baselineManifestArtifactRef`, а не wall-clock; список `NeverGrandfatheredGate` (safety/sandbox/taint/prompt-injection/policy-budget approval/kill-switch) фиксирован и не waivable никогда; legacy-узлы не участвуют в DoubleLoop/SystemSelfImprovement.

---

## 🔗 Связанные артефакты сессии

- План в session workspace: `/Users/demo-user/.copilot/session-state/399e54dc-3fe7-4523-a29b-7eb038d87478/plan.md`
- Todos: SQL `todos` таблица сессии (id `ue-decisions`, `ue-m1-substrate` … `ue-m17-evals-flip`, с зависимостями).
