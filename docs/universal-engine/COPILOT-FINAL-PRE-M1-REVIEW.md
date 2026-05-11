# Задание Copilot: Final Pre-M1 Review & Hardening

**Дата:** 11 мая 2026  
**Автор:** Claude (Main)  
**Цель:** Финальное усиление enforcement и memory-архитектуры перед M1.

---

## 1. Краткий диагноз текущей ревизии

После ревизии `COPILOT-PRE-M1-ENFORCEMENT-REVISION` архитектура стала заметно жёстче. Однако остаётся одна системная проблема:

**Много отличных контрактов — мало ownership и runtime enforcement.**

Особенно страдают:
- CompletionGateEngine (кто и где его реализует?)
- DecisionPoisonSignal scorer
- Historian.distill()
- LegacyNodeAuditReport генерация

Это классическая ситуация, когда контракт написан, но нет чёткого владельца реализации.

Кроме того, необходимо интегрировать Memory Architecture v2.0, которая усилит Double-Loop и Strategy Memory.

---

## 2. Конкретные замечания (что не закрыто)

### 2.1 Enforcement

- `beforeNodeComplete` hook описан, но нет ответа на вопрос: **в каком файле** живёт `CompletionGateEngine` и кто его вызывает?
- `DecisionPoisonSignal[]` scoring описан, но **нет алгоритма** скоринга и места хранения результатов.
- `LegacyNodeAuditReport` описан, но неясно, кто и когда его генерирует (каждый `self_improvement` цикл? отдельный cron?).
- `Historian.distill()` упоминается, но нет описания входных данных и того, как он отличает single-loop от double-loop.

### 2.2 Double-Loop

Сделано хорошо, но недостаёт:
- Explicit mapping: какие типы `AlgorithmicGovernanceContract` могут генерировать `DoubleLoopRecord`.
- Как `StrategyMemoryProvider` при `prefetch()` приоритизирует DoubleLoop записи над Episodic.

### 2.3 Memory Architecture (новый блок)

Текущая память в Pyrfor всё ещё фрагментарна. Нужно интегрировать Memory Architecture v2.0 (отдельный документ).

---

## 3. Задачи (объединённые)

### 3.1 Enforcement Hardening (Critical)

1. **Создать** `CompletionGateEngine` (отдельный модуль или в `orchestrator.ts`).
2. **Реализовать** `beforeNodeComplete` hook как **обязательную** точку.
3. **Добавить** `DecisionPoisonSignal` scorer с явным алгоритмом.
4. **Определить** владельца `LegacyNodeAuditReport` и триггер его генерации.

### 3.2 Double-Loop Mechanics (High)

1. **Расширить** layering: `LessonsLearnedArtifact → SingleLoopRecord / DoubleLoopRecord`.
2. **Усилить** retrieval: `LessonsQuery` должен учитывать `governedByAlgorithm` при ранжировании.
3. **Привязать** `StrategyMemoryProvider` к DoubleLoop записям с приоритетом.

### 3.3 Memory Architecture v2.0 Integration (High)

Ввести следующие компоненты (см. `MEMORY-ARCHITECTURE-V2.md`):

- `MemoryProvider` interface с lifecycle.
- `ContextEngine` с pluggable компрессорами.
- `AlgorithmAwareRetriever` + Impact Scored retrieval.
- `StrategyMemoryProvider` как first-class.
- Интеграция текущей wiki + Decision Provenance.

### 3.4 Ownership & Implementation (Critical)

В каждом обновлённом документе **явно указывать**:
- В каком файле реализуется компонент.
- Кто владелец (orchestrator / new service / agent).
- Какие события генерируются.

---

## 4. Приоритет для M1

| Приоритет | Задача | Входит в M1? |
|-----------|--------|--------------|
| 1 | CompletionGateEngine + beforeNodeComplete | Да |
| 2 | DecisionPoisonSignal scorer + canonical record | Да |
| 3 | LegacyNodeAuditReport генерация и интеграция | Да |
| 4 | Double-Loop retrieval с algorithm-awareness | Частично |
| 5 | MemoryProvider interface (базовый) | Да |
| 6 | StrategyMemoryProvider + ContextEngine | M3–M4 |

---

## 5. Ожидаемый результат

После правки должны быть ответы на вопросы:

- Где точно живёт `CompletionGateEngine`?
- Как именно работает `DecisionPoisonSignal` scoring?
- Кто и когда генерирует `LegacyNodeAuditReport`?
- Как `StrategyMemoryProvider` при `prefetch()` отличает DoubleLoop от остального?
- Какие файлы реализуют Memory Architecture v2.0 компоненты?

---

**Это финальная проверка перед M1.** После этого документа Copilot должен выдать чистые, готовые к реализации спецификации.