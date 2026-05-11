# Задание Copilot: Усиление Алгоритмической Жёсткости

**Дата:** 11 мая 2026  
**Автор:** Claude (Main) после анализа пакета Copilot  
**Цель:** Сделать алгоритмы не декларативными, а реально исполняемыми и контролирующими.

---

## 1. Проблема текущей интеграции

Copilot добавил Algorithmic Governance Layer и 5 алгоритмов. Это хорошая база, но:

- Алгоритмы **декларируются**, но не **контролируют** поведение системы
- Checkpoint'ы, completion criteria, feedback loops описаны высокоуровнево
- Нет **явных правил остановки** циклов
- ToolForge не имеет **TOC-gate** (Theory of Constraints gate)
- Lessons Learned и Double-Loop Learning не имеют **механики** (что именно писать и как использовать)
- Tier Decider "context-aware", но context не определён явно

**Результат:** Архитектура выглядит солидно, но алгоритмы не создают "среду результата".

---

## 2. Конкретные правки (готово к реализации)

### 2.1 `00.5-algorithmic-governance.md`

**Добавить после раздела 0.5.2:**

#### 0.5.2.1 Completion Gates (Обязательные)

Каждый алгоритм имеет **Completion Gate** — условие, при котором цикл считается завершённым.

**Strategic Planning (OODA):**
- Completion Gate: `plan_document` + `budget_profile` + `completion_criteria` + `assumptions` записаны в PlanGraph
- Failure: нет критериев успеха → block

**Research + ToolCreation (Theory of Constraints):**
- Completion Gate: 
  1. `bottleneck_proof` (доказательство главного ограничения)
  2. `reuse_attempted` OR `adaptation_attempted` OR `forge_justified`
  3. `tool_capability_manifest` signed
  4. `tests_passed` + `taint_clean`
- Max ToolForge per cycle: 2 (v1)
- Failure: после 2 попыток → escalate to human

**Execution + QualityControl:**
- Completion Gate:
  1. `execution_result` + `acceptance_test_suite` + `verification_report` (≥2 независимых верификатора)
  2. `failure_classification` если провал
- Self-heal max: 3 loops
- Failure: → `PostMortem` + `LessonsLearned`

**LessonsLearned:**
- Completion Gate: 
  - Single-loop: `defect_fixed` + `root_cause` записаны
  - Double-loop: `governance_adjustment_proposal` создан (если требуется изменение алгоритма/policy)
- Double-loop только через `ApprovalFlow`

**SystemSelfImprovement:**
- Completion Gate: `governance_adjustment_proposal` + `eval_proof` + `rollback_plan` + human approval

#### 0.5.2.2 Feedback Loop Termination Rules

Каждый feedback loop обязан иметь:

```ts
interface FeedbackLoopContract {
  maxLoops: number;
  escalationTriggers: string[]; // конкретные условия
  stopArtifact: string;        // что записывается при остановке
  stopReason: 'max_loops' | 'escalation_trigger' | 'completion_gate_failed';
}
```

Пример для `ToolForge`:
```json
{
  "maxLoops": 2,
  "escalationTriggers": ["bottleneck_not_proven", "reuse_refused_without_justification", "taint_detected"],
  "stopArtifact": "toolforge_cycle_report",
  "stopReason": "max_loops | escalation_trigger"
}
```

#### 0.5.3.1 Decision Record (Обязательный для consequential nodes)

Каждый узел PlanGraph уровня `consequential` обязан записывать `DecisionRecord`:

```ts
interface DecisionRecord {
  nodeId: string;
  algorithm: string;
  alternativesConsidered: string[];
  selectedAlternative: string;
  rationale: string;
  risksAccepted: string[];
  budgetImpact: BudgetVector;
  timestamp: string;
  author: 'system' | 'agent:<id>' | 'human';
}
```

Записывается в `EventLedger` до выполнения узла.

---

### 2.2 `01-strategy-and-goals.md`

**Добавить в 1.2 Принципы (после пункта 5):**

**6. Algorithmic Discipline over Intelligence**  
Интеллект агентов работает **только внутри** границ алгоритма. Если для узла не определён алгоритм — узел блокируется по умолчанию (`TierDecider.block`).

**Добавить в 1.3 Цели v1:**

- ✅ Каждый consequential `PlanGraph` node имеет `governedByAlgorithm`, `completionGate`, `feedbackContract`, `decisionRecord`
- ✅ `ToolForge` governed by `Research + ToolCreation` algorithm с обязательным `TOC-gate` и `PostForge LessonsLearned`

---

### 2.3 `03-lifecycle.md`

**Изменить структуру описания фаз.**

После mermaid-диаграммы добавить таблицу:

| Фаза | Governing Algorithm | Required Checkpoints | Max Loops | Double-Loop Trigger |
|------|---------------------|----------------------|-----------|---------------------|
| `Research + Gap` | `Research + ToolCreation` (TOC) | `bottleneck_proof`, `discovery_report` | 3 | `no_vetted_solution_found` |
| `ToolForge` | `Research + ToolCreation` (TOC) | `manifest`, `tests_passed`, `taint_clean`, `PostForgeReport` | 2 | `forge_failed_twice` |
| `Execute + Test` | `Execution + QualityControl` | `execution_result`, `test_suite`, `verification_report` | 3 | `verification_failed` |
| `PostMortem` | `LessonsLearned` | `single_loop_report`, `double_loop_proposal?` | 1 | `systemic_defect_detected` |

**Добавить после `Post`:**
```
Post --> LessonsLearned --> Done
```

`LessonsLearned` — **отдельный обязательный шаг**, а не часть PostMortem.

---

### 2.4 `05-tool-model.md`

**Добавить в ToolForge контракт:**

**TOC-Gate (Theory of Constraints Gate)** — обязательный перед созданием:

1. `bottleneck_proof` — доказательство, что это **главное** ограничение (а не одно из)
2. `reuse_analysis` — какие существующие инструменты/примитивы рассматривались
3. `adaptation_impossible_justification` — почему адаптация невозможна
4. `forge_justification` — почему новый инструмент решит bottleneck

**Mandatory PostForge LessonsLearned:**

После каждого `ToolForge` (даже для адаптеров) записывается:
- `tool_created` + `bottleneck_addressed` + `expected_impact`
- `algorithm_outcome`: `success` | `partial` | `failed_to_meet_criteria`
- Если `double_loop_trigger`: `governance_adjustment_proposal` создаётся

**Ограничение v1:**
- Max 2 новых executable инструмента (non-adapter) за один `concept_run`

---

### 2.5 `12-risks-and-decisions.md`

**Решение 2 (Balanced governance) — переформулировать:**

| Опция | Поведение |
|-------|---------|
| **Balanced governance (v1)** | Решение принимается `context-aware TierDecider` на основе `decision_vector`: phase + reversibility + sandbox + tool_trust + failure_history + impact + remaining_budget. Глобальный профиль (`notify`/`approve`/`auto`) — только UX hint. |

**Решение 4 (Tool synthesis) — усилить:**

> **Hybrid gated synthesis (v1)** — адаптеры создаются автономно; новый executable код разрешён **только** если:
> - TOC-gate пройден (`bottleneck_proof` + `reuse_refused` + `adaptation_impossible`)
> - Manifest + tests + taint подписаны
> - После создания — mandatory `PostForge LessonsLearned`
> - При двойном провале за цикл — эскалация

---

## 3. Приоритет правок (что делать первым)

| Приоритет | Документ | Изменение | Почему критично |
|-----------|----------|-----------|-----------------|
| 1 | `00.5` | Добавить Completion Gates + Feedback Loop Termination Rules + Decision Record | Без этого алгоритмы остаются декларативными |
| 2 | `03-lifecycle.md` | Таблица "Governing Algorithm + Checkpoints + Max Loops" + LessonsLearned как отдельный шаг | Делает алгоритмы видимыми в lifecycle |
| 3 | `05-tool-model.md` | TOC-Gate + Mandatory PostForge LessonsLearned + max 2 new tools | Самое слабое место по жёсткости |
| 4 | `01-strategy-and-goals.md` | Принцип 6 + цели по governance contract | Фундамент |
| 5 | `12-risks-and-decisions.md` | Переформулировать Решения 2 и 4 под algorithmic governance | Готовит к утверждению |

---

## 4. Что НЕ трогать

- Архитектуру `PlanGraph` / `EventLedger` / `ArtifactStore` / `Tier Decider` / `Effect Gateway`
- 10 агентов и их контракты
- Sandbox tiers
- Verifier Ensemble quorum
- Budget per-concept/per-phase

---

## 5. Ожидаемый результат

После правок:

- Алгоритмы не просто "описаны", а **контролируют** поведение
- Каждый consequential шаг имеет **явные правила завершения и остановки**
- ToolForge подчинён **TOC**, а не "создаём инструмент потому что можно"
- Double-Loop Learning имеет механику, а не только название
- Решения 2 и 4 в 12 документе готовы к утверждению

---

**Готов к реализации.** После правок — перечитать `00.5` и `03` для финальной проверки.