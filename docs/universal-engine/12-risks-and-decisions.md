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
| Early Memory v2 goal drift | M2 is read-path only: `UniversalMemoryFacade` returns approved-only non-legacy/non-rejected/non-quarantined entries; raw lessons never go straight to Planner/ToolForger | M2, [06.1.1](./06-memory-and-strategy.md#611-memory-architecture-v2-ownership) |
| Cross-project memory leakage | Project scope is explicit (`project:<id>` tags / concept scopes); default retrieval does not cross projects unless requested and tested | M2, [06.1.1](./06-memory-and-strategy.md#611-memory-architecture-v2-ownership) |
| Lookahead/backtracking runaway | Lookahead lives only inside Planner/SelfHeal, never Orchestrator; hard caps: `maxBranches`, `maxDepth`, `maxBacktracks`, `requiresNewEvidence` | M6/M12 |
| Регрессия FreeClaude | Аддитивность + feature flag до M17 + regression suite | M1–M17, [10.4](./10-roadmap-milestones.md#104-migration-discipline) |
| Silent self-modification | Все meta-changes через gated lifecycle + rollback | M15 |
| Resume after crash | Phase-boundary snapshots + content-addressed artifacts + PlanGraph re-hydration | M7 |
| Shadow governance | Algorithmic Governance только как meta-layer; без отдельного store/scheduler | [00.5](./00.5-algorithmic-governance.md), [02.2](./02-architecture.md#22-algorithmic-governance-layer) |
| Governance thrash / oscillation | `Completion Gate` + `FeedbackLoopContract` (`maxLoops`, `requiresNewEvidence`, `stopArtifactKind`) + budget-exhaustion precedence + single bottleneck per TOC-cycle | [03.2](./03-lifecycle.md#32-алгоритмическая-карта-фаз) |
| Goodhart по метрикам алгоритмов | Outcome-first verification; метрики не могут заменить acceptance criteria | M5/M12/M17 |
| Governance lock-up / legacy freeze | Жёсткое правило «нет алгоритма → block» применяется только к новым consequential nodes; legacy nodes получают `algorithmCoverage: grandfathered` + дефолтный phase→algorithm маппинг + событие `governance.legacy_node` | [00.5.3.1](./00.5-algorithmic-governance.md#0531-decision-record-обязателен-для-consequential-nodes) |
| DecisionRecord poisoning / audit-log DoS | `DecisionRecord` валиден только при наличии `nodeHash` + `evidenceRefs`; для дешёвых автономных узлов — `DecisionRecordLite` с `templateId`; rationale без evidence отбрасывается; ledger pruning policy для невалидных записей | [07.6.1](./07-safety-and-governance.md#761-обязательные-governance-артефакты-для-consequential-nodes) |
| Tool-cap starvation / concept fragmentation | Cap считается по distinct new executable capabilities, лимит вешается на `parentConceptId`/lineage; адаптеры не списывают слот; soft 2 / hard 3 через approval; child-concepts наследуют остаток cap | [05.4.3](./05-tool-model.md#543-ограничение-v1-на-синтез) |
| Completion Gate bypass / silent skip | `CompletionGateEngine` enforced на orchestrator hook `beforeNodeComplete`; нет `dag.node.completed` без `governance.gate.checked` (`passed` или `waived_by_approval`); `evidence_snapshot_hash` гарантирует идемпотентность и replay | [00.5.8](./00.5-algorithmic-governance.md#058-enforcement-completion-gate-engine), [03.7](./03-lifecycle.md#37-enforcement-completion-gate-engine-на-границе-фаз) |
| Permanent gate brick (failed_retryable без пути forward) | `failed_retryable` → `awaiting_new_evidence`; новая попытка валидна только при изменении `evidence_snapshot_hash`; identical snapshot = noop; `failed_terminal` идёт через `ApprovalFlow` или явный отказ узла | [00.5.8](./00.5-algorithmic-governance.md#058-enforcement-completion-gate-engine) |
| Date-cutoff legacy bypass / clock spoof | Eligibility основана на git-tagged baseline manifest (`baselineTag` + `baselineCommit` + `baselineManifestArtifactRef`), а не на wall-clock; узел вне manifest = `safety_block` + escalation | [00.5.10](./00.5-algorithmic-governance.md#0510-legacy-grandfathering-reproducible-eligibility--bounded-scope) |
| Legacy-driven governance proposals | Legacy lessons помечаются `provenance: 'legacy'`, исключены из default LessonsQuery для Strategist/ToolForger, не могут породить `governance_adjustment_proposal` | [00.5.10](./00.5-algorithmic-governance.md#0510-legacy-grandfathering-reproducible-eligibility--bounded-scope) |
| Safety-gate waiving через approval | `NeverGrandfatheredGate` (safety, sandbox tier, taint, prompt-injection scan, approval-for-policy/budget, kill-switch) — фиксированный список; попытка `waived_by_approval` для них = `safety_block` | [07.6.4](./07-safety-and-governance.md#764-never-grandfathered-safety-gates) |
| ToolForge cap race / oversubscription | Lineage-scoped reservation/commit/release events на EventLedger; concurrent ToolForge на одной lineage сериализуются по `parentConceptId`; approval привязан к конкретному `capabilityFingerprint` | [05.4.4](./05-tool-model.md#544-lineage-scoped-enforcement-preflight--commit) |
| DecisionRecord poisoning по count | Заменено на canonical-record + suspicion-score модель; quarantine при наличии валидного canonical; `conflicting_same_node_hash` с двумя authoritative canonical → `safety_block`, не `gate_failed` | [07.6.5](./07-safety-and-governance.md#765-decisionrecord-poisoning-protection) |
| DoubleLoop proposal thrash после rejection | `similarityKey` + `requiresNovelEvidenceAfterRejection`; одинаковое предложение требует новое evidence / изменённое правило / cooldown + fresh failure-cluster | [06.6](./06-memory-and-strategy.md#anti-thrash-для-отклонённых-doubleloop) |
| «Учёт уроков» как fake-tick | `DecisionRecord.lessonsConsidered` хранит `LessonDecisionImpact` с `disposition` + `impactSummary` + `lessonSnapshotHash`; ID без эффекта не считается доказательством | [00.5.9](./00.5-algorithmic-governance.md#059-lessons-layering-single-loop-double-loop-strategy-memory) |
| Verifier retry budget abuse | Покрывает только `verifier_disagreement` + `external_dependency_failed`; не покрывает `gate_failed`, `safety_block`, `tool_cap_exhausted`, `decision_record_invalid` | [07.6.6](./07-safety-and-governance.md#766-verifier-retry-budget--scope) |

---

## 12.2 5 решений для старта M1

> Для старта M1 приняты рабочие defaults. Их можно пересмотреть позже через `governance_adjustment_proposal`, но реализация M1 больше не блокируется.

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

> ✅ Рабочий default для M1: **Balanced governance**.

### Решение 3 — Sandbox baseline

| Опция | M3 поставляет | Когда Docker |
|---|---|---|
| **Local-process + Wasm** (рекомендация) | LocalProcessBackend + WasmBackend | M10 (Docker + Firecracker) |
| **+ Docker сразу** | + DockerBackend | сразу |

> ✅ Рабочий default для M1: **Local-process + Wasm**. Docker/Firecracker остаются после базового Effect Gateway.

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

> ✅ Рабочий default для M1: **Hybrid gated synthesis (v1)**.

### Решение 5 — Seed Strategy Memory

| Опция | |
|---|---|
| **Start empty** | strategic memory копится только из явных user-команд + Historian-distilled с approval |
| **Import patterns from existing Pyrfor usage** | загрузить готовые паттерны из текущего кода/конфига Pyrfor |

> ✅ Рабочий default для M1: **Start empty**. Импорт существующих паттернов допускается только как Historian backfill с provenance и без auto-approval.

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
| 2026-05-11 | Pre-M1 enforcement hardening | user + Copilot pre-M1 enforcement spec | Gates стали runtime-объектами: `CompletionGateEngine` + `governance.gate.checked` / `governance.gate.violation` события + orchestrator hook `beforeNodeComplete`; admission vs completion gates разделены; failed_retryable требует новой `evidence_snapshot_hash` (защита от brick); ToolForge cap → lineage-scoped reservation/commit/release с `capabilityFingerprint`; DecisionRecord poisoning защищён canonical+suspicion-score моделью (вместо сырого count-limit); legacy grandfathering привязан к git-tagged baseline manifest (не date cutoff); фиксированный список `NeverGrandfatheredGate` (safety/sandbox/taint/prompt-injection/policy-budget approval/kill-switch); LessonsLearnedArtifact → SingleLoop/DoubleLoop layering с `LessonsQuery` (applicability-first) и `LessonDecisionImpact` (доказательство учёта урока); anti-thrash через `similarityKey` + `requiresNovelEvidenceAfterRejection`; verifier retry budget scope зафиксирован (`verifier_disagreement` + `external_dependency_failed` only) |
| 2026-05-11 | Final Pre-M1 ownership defaults | user + Copilot final pre-M1 review | M1 разблокирован рабочими defaults: Balanced governance, LocalProcess+Wasm sandbox baseline, Hybrid gated ToolForge, Start-empty Strategy Memory. Ownership закреплён в runtime: `CompletionGateEngine`, `DecisionRecordAuditor`, `LegacyNodeAuditor`, `Historian.distill`, MemoryProvider/StrategyMemoryProvider/AlgorithmAwareRetriever contracts. |
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
