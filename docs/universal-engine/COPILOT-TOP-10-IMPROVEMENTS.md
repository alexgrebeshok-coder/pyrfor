# Top 10 Improvements over Current Universal Engine Plan

**Дата:** 11 мая 2026  
**Авторы:** Claude (Main) + Copilot (текущий план)  
**Цель:** Добавить поверх существующего плана 10 ключевых улучшений, которые дадут значительное преимущество над Claude Code, Cursor, Windsurf и другими coding-агентами 2026 года.

---

## Приоритеты улучшений

Я разделил улучшения на три группы по приоритету.

### Группа А — Высокий приоритет (делать в первую очередь)

#### 1. Memory Architecture v2.0 (Самое важное)

**Проблема:** Текущая память в Pyrfor фрагментарна и уступает Hermes, MemGPT и современным системам.

**Что предлагается:**
- Ввести `MemoryProvider` interface с lifecycle (вдохновлено Hermes).
- Добавить `ContextEngine` с pluggable компрессорами (Summary, EntityGraph, DecisionRecord, ToolForge, Wiki).
- Сделать **Strategy Memory** first-class (с Double-Loop приоритетом).
- Ввести `AlgorithmAwareRetriever` — память понимает, каким алгоритмом она создана.
- Интегрировать текущую wiki + Decision Provenance.

**Почему это важно:**
- Claude Code и Cursor сильно теряют качество на длинных задачах из-за плохой памяти.
- Память v2.0 — это фундамент, на котором строится всё остальное (Double-Loop, Compounding, Self-Improvement).

**Когда добавлять:** M3–M8

---

#### 2. Double-Loop + Meta-Critic Self-Improvement

**Проблема:** У всех конкурентов (Claude Code, Cursor, Devin) самоулучшение либо отсутствует, либо очень слабое.

**Что предлагается:**
- Реальная механика `LessonsLearnedArtifact → SingleLoopRecord / DoubleLoopRecord`.
- `Historian.distill()` как отдельный компонент.
- `Meta-Critic` агент, который анализирует паттерны неудач и предлагает изменения в алгоритмы/эвристики.
- Gated Self-Improvement (только через approval + eval).

**Преимущество:**
- Это может стать **главным стратегическим преимуществом** Pyrfor над всеми существующими coding-агентами.

**Когда добавлять:** M7–M13

---

#### 3. ContextEngine + Hierarchical Compression

**Проблема:** При длинных задачах контекст быстро деградирует, и агент начинает терять важные детали.

**Что предлагается:**
- Pluggable `ContextEngine` (Hermes-style, но с учетом алгоритмов).
- Hierarchical summarization (RAPTOR-style).
- Long-term memory compression с сохранением Decision Records и ключевых артефактов.

**Когда добавлять:** M4–M9

---

### Группа B — Средний приоритет

#### 4. Algorithm / Impact-Aware Retrieval

Память должна уметь отвечать не только "что произошло", но и "какой алгоритм это сделал" и "насколько это повлияло".

- Добавить `impactScore` к memory-записям.
- Retrieval ранжирует по `impact + applicability + recency`.

#### 5. Skill & Algorithm Compounding

Возможность автоматически комбинировать существующие алгоритмы и навыки и предлагать новые комбинации на основе Lessons Learned (Hermes + Voyager style).

#### 6. Multi-step Reasoning with Lookahead + Backtracking

Сейчас планирование в основном линейное. Нужно добавить возможность "посмотреть вперёд" и при необходимости вернуться (Tree-of-Thoughts / AlphaCodium style).

---

### Группа C — Будущие / Высокого уровня улучшения

#### 7. Video + Vision Analysis Pipeline

Интеграция YOLO + MOT + frame understanding как отдельной capability (как ты и говорил раньше).

#### 8. Cost-Aware Reasoning

Планирование с явным учётом стоимости (токены, время, деньги) заранее, а не только через бюджетные ограничения.

#### 9. Persistent Cross-Concept Project Memory

Память должна сохраняться не только внутри одной `concept_run`, а между разными задачами в рамках одного проекта.

#### 10. Interactive Clarification Loop UX (быстрый win)

Улучшить процесс уточнения задачи (как делает Claude Code в Composer) — это относительно просто и даёт хороший пользовательский опыт сразу.

---

## Интеграция в roadmap (после мультиагентного review)

Top-10 не внедряется как отдельная параллельная программа. Он раскладывается по существующему safety-first roadmap так, чтобы память усиливала систему, но не обходила governance.

| # | Improvement | Статус после M1/M2 slice | Где живёт | Когда full |
|---|---|---|---|---|
| 1 | Memory Architecture v2.0 | M1 contracts + M2 read-path начаты | `runtime/universal/memory/*`, [06](./06-memory-and-strategy.md) | M2→M13 |
| 2 | Double-Loop + Meta-Critic | `Historian.distill()` есть; Meta-Critic позже | `historian.ts`, `memory/types.ts`, M15 | M13→M15 |
| 3 | ContextEngine + compression | `ContextEngine` skeleton composes `ContextCompiler`; compressors позже | `memory/context-engine.ts` | M3/M13 |
| 4 | Algorithm/Impact retrieval | `AlgorithmAwareRetriever` есть; M2 adds project/approved filtering | `memory/algorithm-aware-retriever.ts` | M2→M8 |
| 5 | Skill & Algorithm Compounding | не сейчас; зависит от verified lessons + ToolRegistry history | M13/M15 | M15+ |
| 6 | Lookahead + Backtracking | только bounded planner branch-search, не Orchestrator loop | Planner/SelfHeal | M6/M12 |
| 7 | Video + Vision Pipeline | future capability family | ToolRegistry / ToolForge | post-M17 |
| 8 | Cost-Aware Reasoning | hard budget in M4, soft planning heuristics in M6 | `tier-decider.ts`, `token-budget-controller.ts` | M4/M6 |
| 9 | Persistent Cross-Concept Project Memory | M2 read-path via `ConceptStore` + project-scoped facade | `memory/concept-store.ts`, `memory-facade.ts` | M2→M13 |
| 10 | Interactive Clarification UX | bounded clarification loop in Planner/API/CLI | M6/M9 | M6/M9 |

**Безопасный split rollout:**

1. **M2 read-path only:** approved-only Strategy/lesson retrieval, concept/project scoping, no raw/quarantined/legacy lessons injected into Planner.
2. **M3 context read-time:** deterministic `ContextEngine` compressors with hard slice/token limits.
3. **M6 planner use:** `LessonsQuery` and clarification UX become planner inputs; lookahead/backtracking gets strict `maxBranches`, `maxDepth`, `maxBacktracks`.
4. **M13 write-path:** Historian backfill, conflict approval, full Memory v2 consolidation.
5. **M15 self-improvement:** Meta-Critic can propose, never activate, governance changes without eval proof + approval + rollback.

---

## Итоговый приоритет (Top 5)

1. **Memory Architecture v2.0** — фундамент
2. **Double-Loop + Meta-Critic** — стратегическое преимущество
3. **ContextEngine + Hierarchical Compression** — качество на длинных задачах
4. **Algorithm/Impact-Aware Retrieval**
5. **Skill & Algorithm Compounding**

---

**Рекомендация:**  
После Enforcement Hardening (M1) переходить не к «полной Memory v2.0 сразу», а к **M2 Memory read-path**: `ConceptStore`, `UniversalMemoryFacade`, approved-only retrieval, project scope и тесты изоляции. Это даёт прирост качества без раннего риска memory poisoning / goal drift.
