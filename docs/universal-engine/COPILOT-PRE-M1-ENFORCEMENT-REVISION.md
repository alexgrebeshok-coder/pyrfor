# Задание Copilot: Pre-M1 Enforcement Hardening

**Дата:** 11 мая 2026  
**Автор:** Claude (Main)  
**Цель:** Устранить критические пробелы в enforcement и Double-Loop механике перед запуском M1.

---

## 1. Проблема текущего состояния

После ревизии `COPILOT-REVISION-TASK-ALGORITHMIC-RIGOR` архитектура стала значительно жёстче, но остались три критически слабых места:

1. **Completion Gates не enforced** — gates описаны, но нет механизма, который реально блокирует узлы при их нарушении.
2. **Double-Loop Learning остался декларативным** — нет механики записи и чтения уроков.
3. **Legacy grandfathering без защиты** — существует риск обхода алгоритмов через `governance.legacy_node`.

Эти три проблемы должны быть закрыты **до старта M1**.

---

## 2. Задачи (в порядке приоритета)

### 2.1 Enforcement Completion Gates (Critical)

**Проблема:**  
Completion Gates описаны в `00.5` как таблица артефактов, но нет runtime-механизма, который проверяет их выполнение и блокирует узел.

**Требования:**

1. **Добавить `CompletionGateEngine`** (или расширить `UniversalEngineOrchestrator`):
   - Перед `completeNode()` orchestrator вызывает `CompletionGateEngine.validate(nodeId)`.
   - Если gate не прошёл — узел остаётся в состоянии `blocked` с причиной `gate_failed`.
   - Создаётся `GateViolationEvent` в EventLedger.

2. **Реализовать проверку gates** для следующих фаз (M1 scope):
   - `PlanSynthesis` → `Strategic Planning Gate`
   - `ToolForge` → `TOC-Gate` (уже описан, нужно enforcement)
   - `Execute + Verify` → `Execution Quality Gate`
   - `PostMortem` → `LessonsLearned Gate`

3. **Добавить `gate_check` событие**:
   ```ts
   interface GateCheckEvent {
     nodeId: string;
     algorithm: string;
     requiredArtifacts: string[];
     presentArtifacts: string[];
     missingArtifacts: string[];
     passed: boolean;
     timestamp: string;
   }
   ```

4. **Приоритет enforcement:**
   - `gate_failed` → `block` (выше `approve`)
   - Бюджет node не расходуется при `gate_failed`

**Ожидаемый результат:**  
Если узел `ToolForge` не прошёл TOC-Gate (отсутствует `bottleneck_proof`), он не может перейти в `completed`.

---

### 2.2 Double-Loop Learning Mechanics (High)

**Проблема:**  
`LessonsLearned` и `Double-Loop` описаны, но нет механики:
- Что именно записывается в Strategy Memory
- Как алгоритмы потом это читают и используют
- Как отделить `single_loop` (исправление дефекта) от `double_loop` (изменение правила/алгоритма)

**Требования:**

1. **Ввести два типа `LessonsLearnedRecord`**:

   - `SingleLoopRecord`:
     - `defectRootCause`
     - `fixApplied`
     - `evidenceRef`
     - `algorithmOutcome` (`improved` | `neutral` | `worsened`)

   - `DoubleLoopRecord` (требует approval):
     - `proposedChangeType`: `algorithm` | `heuristic` | `policy` | `budget` | `verifier_rules`
     - `currentRule`
     - `proposedRule`
     - `expectedImpact`
     - `risks`
     - `rollbackPlan`

2. **Добавить `StrategyMemoryWriter`**:
   - При `PostMortem` orchestrator вызывает `LessonsLearnedEngine.extract(nodeId)`.
   - Если обнаружен `systemic_defect` → создаётся `DoubleLoopRecord` + `governance_adjustment_proposal`.

3. **Добавить чтение уроков**:
   - Перед `PlanSynthesis` и `ToolForge` — `Strategist` / `ToolForger` обязаны читать последние 5–10 `DoubleLoopRecord` из Strategy Memory (с приоритетом по `impact_score`).
   - Это должно быть отражено в `DecisionRecord` (`lessonsConsidered`).

4. **Инвариант:**
   - `DoubleLoopRecord` не применяется автоматически. Только через `ApprovalFlow`.

**Ожидаемый результат:**  
После цикла `ToolForge` система не просто фиксирует "инструмент создан", а понимает, изменился ли алгоритм или эвристика, и записывает это в Strategy Memory для будущих циклов.

---

### 2.3 Legacy Grandfathering Protection (High)

**Проблема:**  
Существует событие `governance.legacy_node`, которое позволяет помечать узлы как `grandfathered`. Это необходимо для миграции, но создаёт риск постоянного обхода алгоритмов.

**Требования:**

1. **Ограничить grandfathering**:
   - Только для узлов, созданных **до** определённой даты (`governance.legacy_mode_enabled_until`).
   - После этой даты новые узлы не могут быть grandfathered.

2. **Добавить `LegacyNodeAudit`**:
   - Каждые 30 дней (или при `self_improvement` цикле) система генерирует отчёт:
     - Сколько узлов до сих пор grandfathered
     - Какие алгоритмы они обходят
     - Рекомендация по переводу на governance

3. **Добавить `grandfathering_scope`**:
   - Grandfathered узел может обходить **только конкретные gates**, перечисленные в `grandfathering_scope`.
   - Нельзя grandfather'ить весь узел целиком.

4. **Инвариант:**
   - Grandfathered узлы **не могут** участвовать в `DoubleLoop` и `SystemSelfImprovement` (они не учитываются при обучении).

**Ожидаемый результат:**  
Legacy grandfathering становится временной мерой миграции, а не постоянной дырой в алгоритмической дисциплине.

---

## 3. Дополнительные мелкие доработки (Medium)

1. **ToolForge hard cap enforcement**:
   - Добавить проверку `toolCreationSlots` в `token-budget-controller`.
   - При превышении 3 инструментов — `block` + `tool_cap_exhausted`.

2. **DecisionRecord poisoning mitigation**:
   - Ввести лимит `maxDecisionRecordsPerNode` (например, 5).
   - При превышении — `block` + событие `decision_record_spam_detected`.

3. **Verifier retry budget**:
   - Уже введён `verifierRetryBudget` (1–2). Нужно явно описать, какие случаи покрывает (`verifier_disagreement`, `external_dependency_failed`), а какие — нет (`gate_failed`, `safety_block`).

---

## 4. Приоритет и Scope M1

| Приоритет | Задача | Документы | Входит в M1? |
|-----------|--------|-----------|--------------|
| 1 | Enforcement Completion Gates | `00.5`, `03`, orchestrator | Да |
| 2 | Double-Loop Mechanics | `00.5`, `06`, `01` | Да (частично) |
| 3 | Legacy Grandfathering Protection | `00.5`, `07` | Да |
| 4 | ToolForge hard cap + DecisionRecord poisoning | `05`, `07` | Да |
| 5 | Verifier retry budget детализация | `07` | Желательно |

---

## 5. Ожидаемый результат после правок

- Ни один узел не может перейти в `completed`, если не прошёл Completion Gate.
- Double-Loop Learning имеет реальную механику записи и чтения уроков.
- Legacy grandfathering ограничен по времени и scope.
- Алгоритмическая дисциплина становится не только документированной, но и enforced.

---

Готов к реализации. Поправь и прокомментируй.