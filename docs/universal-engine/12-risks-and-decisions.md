# 12 — Risks & Open Decisions

> ← [11 — Prior Art](./11-prior-art.md) · ↑ [README](./README.md)

---

## 12.1 Топ-риски и митигации (уже встроены в план)

| Риск | Митигация | Где |
|---|---|---|
| Verifier collusion | Family-diversity rule + executable verifier + meta-verification | M5, [04.4](./04-multi-agent-topology.md#44-правила-независимости-верификаторов) |
| Tool synthesis runaway | TOC-Gate (4 артефакта) + max 2 ToolForge cycles + max 2 новых executable non-adapter tools per `concept_run` (soft 2/hard 3 через approval) + manifest-first + static+dynamic taint + sandbox tiers + per-tool budgets + eviction | M11 (после M3/M4/M5), [05](./05-tool-model.md) |
| Goal drift / reward hacking | Strategy memory anchored to user goals + meta-improvements gated | M15, [01.2](./01-strategy-and-goals.md#12-принципы-hard) |
| Prompt injection через web | Injection-scan verifier + evidence quoting + no-net at synthesis | M6, [07.9](./07-safety-and-governance.md#79-защита-от-prompt-injection) |
| Context bloat / infinite consultation | Hard turn budgets + deterministic tie-breakers + single source of truth | M5/M7, [04.5](./04-multi-agent-topology.md#45-протокол-шины-bus--protocol) |
| Cost explosion | Per-concept/per-phase/per-tool budgets + downgrade (кроме Verifier) | M4/M8, [08.5](./08-multi-model-policy.md#85-budget-aware-downgrade) |
| Memory poisoning | Mandatory provenance + source-quality gate + conflict→approval + quarantine | M13, [06.7](./06-memory-and-strategy.md#67-anti-poisoning) |
| Регрессия FreeClaude | Аддитивность + feature flag до M17 + regression suite | M1–M17, [10.4](./10-roadmap-milestones.md#104-migration-discipline) |
| Silent self-modification | Все meta-changes через gated lifecycle + rollback | M15 |
| Resume after crash | Phase-boundary snapshots + content-addressed artifacts + PlanGraph re-hydration | M7 |
| Shadow governance | Algorithmic Governance только как meta-layer; без отдельного store/scheduler | [00.5](./00.5-algorithmic-governance.md), [02.2](./02-architecture.md#22-algorithmic-governance-layer) |
| Governance thrash / oscillation | `Completion Gate` + `FeedbackLoopContract` (`maxLoops`, `requiresNewEvidence`, `stopArtifactKind`) + budget-exhaustion precedence + single bottleneck per TOC-cycle | [03.2](./03-lifecycle.md#32-алгоритмическая-карта-фаз) |
| Goodhart по метрикам алгоритмов | Outcome-first verification; метрики не могут заменить acceptance criteria | M5/M12/M17 |
| Governance lock-up / legacy freeze | Жёсткое правило «нет алгоритма → block» применяется только к новым consequential nodes; legacy nodes получают `algorithmCoverage: grandfathered` + дефолтный phase→algorithm маппинг + событие `governance.legacy_node` | [00.5.3.1](./00.5-algorithmic-governance.md#0531-decision-record-обязателен-для-consequential-nodes) |
| DecisionRecord poisoning / audit-log DoS | `DecisionRecord` валиден только при наличии `nodeHash` + `evidenceRefs`; для дешёвых автономных узлов — `DecisionRecordLite` с `templateId`; rationale без evidence отбрасывается; ledger pruning policy для невалидных записей | [07.6.1](./07-safety-and-governance.md#761-обязательные-governance-артефакты-для-consequential-nodes) |
| Tool-cap starvation / concept fragmentation | Cap считается по distinct new executable capabilities, лимит вешается на `parentConceptId`/lineage; адаптеры не списывают слот; soft 2 / hard 3 через approval; child-concepts наследуют остаток cap | [05.4.3](./05-tool-model.md#543-ограничение-v1-на-синтез) |

---

## 12.2 5 открытых решений (подтвердить ДО старта M1)

> Эти решения существенно влияют на план. Без них M1 начинать не стоит.

### Решение 1 — Объём «универсальности» в v1

| Опция | Плюсы | Минусы |
|---|---|---|
| **Только программные артефакты** (web/CLI/API/scripts) | Быстрый старт, существующие тесты применимы, fast feedback | Меньше «универсальности» в первой версии |
| **Кросс-домен с самого начала** (код + тексты + аналитика + бизнес) ✅ *выбрано пользователем* | Сразу проверяем универсальность контракта, шире пользовательская ценность | Сложнее тесты приёмки, больше edge cases |
| Только код, никакой генерации не-кодовых артефактов | Простейший scope | Существенно сужает миссию |

### Решение 2 — Алгоритм автономии по умолчанию

> После интеграции Algorithmic Governance глобальный `notify | approve | auto` становится **UX-profile**, а runtime-решение принимает context-aware Tier Decider.

| Опция | Поведение | Рекомендация |
|---|---|---|
| **Conservative governance** | reversible sandbox actions → `notify`; ToolForge/нет/широкий fs → `approve`; минимум silent autonomy | подходит для раннего тестирования |
| **Balanced governance (v1)** | runtime-решение принимает `context-aware TierDecider` на основе `decision_vector = phase + governedAlgorithm + reversibility + sandbox + tool_trust + failure_history + impact + remaining_budget + loopCount/newEvidence + gateStatus + algorithmCoverage + toolCapRemaining`. Глобальный профиль (`notify` / `approve` / `auto`) — только UX hint. Порядок приоритета: `safety block > gate failed > tool cap exhausted > approve > notify > autonomous`. | **рекомендовано для v1** |
| **Aggressive governance** | больше действий `autonomous`; approval в основном для host/policy/prod/secrets | позже, после eval-suite и trust history |

> 🟡 Не подтверждено пользователем. Архитектурная рекомендация: **Balanced governance**.

### Решение 3 — Sandbox baseline

| Опция | M3 поставляет | Когда Docker |
|---|---|---|
| **Local-process + Wasm** (рекомендация) | LocalProcessBackend + WasmBackend | M10 (Docker + Firecracker) |
| **+ Docker сразу** | + DockerBackend | сразу |

> 🟡 Не подтверждено.

### Решение 4 — Алгоритм синтеза инструментов

> ToolForge теперь управляется Theory of Constraints: сначала доказать главный bottleneck, затем `reuse → adapt → forge`, после каждого цикла — mandatory Lessons Learned.

| Опция | Что разрешено генерировать | Safety |
|---|---|---|
| **Adapter-first** | wrappers / orchestration / glue над vetted primitives | самый безопасный старт, но хуже универсальность |
| **Hybrid gated synthesis (v1)** | адаптеры создаются автономно; новый executable code разрешён только если пройден TOC-Gate (4 артефакта), v1-лимит не исчерпан, `tool_capability_manifest` + tests + taint подписаны и после цикла записан mandatory `PostForge LessonsLearned` | **рекомендовано для v1** |
| **Open synthesis** | scripts, API clients, MCP servers, Wasm modules по manifest-first pipeline | позже, после M17 evals/trust history |

> **Hybrid gated synthesis (v1) — нормативная формулировка.** Новый executable код разрешён **только** если:
> - TOC-Gate пройден: `bottleneck_proof` + `reuse_analysis` + `adaptation_impossible_justification` + `forge_justification`;
> - `tool_capability_manifest` подписан, тесты пройдены, static + dynamic taint clean;
> - Записан mandatory `PostForge LessonsLearned` (с `algorithmOutcome` и `evidenceRefs`);
> - При двойном провале ToolForge за один cycle — escalation через `ApprovalFlow`;
> - За один `concept_run` допускается не более 2 новых executable non-adapter tools (soft cap 2 / hard cap 3 через approval).

> 🟡 Не подтверждено пользователем. Архитектурная рекомендация: **Hybrid gated synthesis**.

### Решение 5 — Seed Strategy Memory

| Опция | |
|---|---|
| **Start empty** | strategic memory копится только из явных user-команд + Historian-distilled с approval |
| **Import patterns from existing Pyrfor usage** | загрузить готовые паттерны из текущего кода/конфига Pyrfor |

> 🟡 Не подтверждено.

---

## 12.3 Доп. вопросы для дальнейшего уточнения (после M1)

- Какие deliverable kinds приоритетны (web app, CLI, API, library, document, dashboard)?
- Какие external integrations нужны в первую очередь (GitHub, npm, PyPI, Docker Hub, …)?
- Кто получает уведомления о completion / approval (CLI / VS Code / Telegram / email)?
- Есть ли требования compliance (логи в S3? GDPR?)?
- Нужен ли multi-tenant режим в gateway?

---

## 12.4 Журнал решений (decision log)

| Дата | Решение | Источник | Обоснование |
|---|---|---|---|
| (заполняется) | Кросс-домен с начала | user | … |
| 2026-05-11 | Добавить Algorithmic Governance Layer | user + internal council concept | Усиливает существующий safety-stack без перепроектирования lifecycle; добавляет OODA, TOC, Double-Loop Learning, context-aware budgets и Lessons Learned |
| 2026-05-11 | Algorithmic rigor hardening | user + Copilot revision spec | Алгоритмы операционализированы: добавлены Completion Gates, FeedbackLoopContract (с `requiresNewEvidence` и budget-exhaustion precedence), DecisionRecord с audit-инвариантами, формальный TOC-Gate из 4 артефактов, PostForge LessonsLearned schema, лимит v1 = 2 новых executable non-adapter tools per concept_run, legacy-node grandfathering, формальный `decision_vector` |
| | | | |

> Все решения дальше сюда добавляем at-will, чтобы был аудит «почему так».

---

## 12.5 Связанные документы

- [README — индекс](./README.md)
- Полные транскрипты обсуждения:
  - [agent-discussions/arch-gpt55.md](./agent-discussions/arch-gpt55.md)
  - [agent-discussions/arch-opus.md](./agent-discussions/arch-opus.md)
  - [agent-discussions/prior-art.md](./agent-discussions/prior-art.md)
  - [agent-discussions/decomp-sonnet.md](./agent-discussions/decomp-sonnet.md) (если был сохранён)
- Session plan: `~/.copilot/session-state/399e54dc-3fe7-4523-a29b-7eb038d87478/plan.md`
