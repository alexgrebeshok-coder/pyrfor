# Pyrfor Memory Architecture v2.0 — Better than Hermes

**Статус:** Предложение для обсуждения  
**Дата:** 11 мая 2026  
**Цель:** Создать memory-архитектуру, которая сочетает лучшее из Hermes, современных систем 2025–2026 и наших алгоритмических преимуществ.

---

## 1. Проблема текущей памяти в Pyrfor

Текущая память в Pyrfor (май 2026) имеет следующие слабости:

- **Фрагментарность** — память разбросана между `memory/*.md`, `wiki/`, `EventLedger`, `StrategyStore`, `RunLedger`. Нет единой абстракции.
- **Слабая контекстная компрессия** — при длинных сессиях контекст быстро деградирует.
- **Отсутствие lifecycle** — нет чёткого `initialize → prefetch → sync → shutdown` у memory-провайдеров.
- **Слабая entity-relationship модель** — связи между сущностями (людьми, задачами, решениями) плохо отслеживаются.
- **Нет skill compounding** — уроки и паттерны не комбинируются автоматически.
- **Hermes уже лучше** в части MemoryProvider + ContextEngine + structured retrieval.

**Вывод:** Чтобы Pyrfor стал лучшей memory-ориентированной системой, нам нужно **превзойти Hermes**, а не просто догнать его.

---

## 2. Что мы берём из Hermes (конкретно)

### 2.1 MemoryProvider Interface (Hermes v0.10+)

Мы вводим похожий интерфейс, но расширяем его:

```ts
interface MemoryProvider {
  initialize(context: RunContext, strategy: MemoryStrategy): Promise<void>;

  prefetch(relevantEntities: EntityRef[], horizon: TimeHorizon): Promise<MemorySlice[]>;

  syncTurn(turn: TurnData): Promise<MemoryWriteResult>;

  query(query: MemoryQuery): Promise<MemoryResult>;

  compress(scope: CompressionScope): Promise<CompressionReport>;

  shutdown(): Promise<void>;
}
```

**Отличия от Hermes:**
- Добавлен `query()` с поддержкой алгоритмических фильтров.
- Добавлен `compress()` с `CompressionStrategy` (наш Double-Loop aware).
- `syncTurn()` возвращает не только результат, но и `lessonsDetected`.

### 2.2 ContextEngine + Pluggable Compressors

Hermes делает **очень хорошую работу** с контекстной компрессией. Мы берём эту идею, но делаем её **алгоритмо-awareness**.

**Предлагаемые компрессоры:**

| Компрессор | Когда используется | Наш improvement |
|------------|--------------------|-----------------|
| `SummaryCompressor` | Длинные эпизодические цепочки | + Double-Loop summary (что изменилось в стратегии) |
| `EntityGraphCompressor` | Много сущностей и связей | + AlgorithmImpact edges |
| `DecisionRecordCompressor` | Много DecisionRecord | Сохраняет `rationale` + `alternativesConsidered` |
| `ToolForgeCompressor` | Много созданных инструментов | Группирует по bottleneck'ам |

---

## 3. Что мы делаем лучше Hermes (наше преимущество)

### 3.1 Algorithm-Aware Memory (Уникальное преимущество Pyrfor)

Память в Pyrfor должна **знать**, каким алгоритмом она управляется.

Каждая запись памяти получает поле:

```ts
interface AlgorithmicMemoryRecord {
  content: any;
  governedByAlgorithm: 'strategic_planning' | 'research_tool_creation' | 'execution_quality_control' | 'lessons_learned' | 'system_self_improvement';
  algorithmPhase: string;
  decisionRecordRef?: string;
  doubleLoopLevel: 'single' | 'double';
  impactScore: number; // 0–100
  usedByFutureAlgorithms: string[];
}
```

**Результат:**  
Когда `Planner` или `ToolForger` читают память, они видят не только факты, но и **какие алгоритмы** их породили и насколько они повлияли.

### 3.2 Double-Loop Native Memory

Hermes хранит уроки, но не различает single-loop и double-loop.

Мы вводим два типа записей:

- **SingleLoopMemory** — исправление текущей задачи.
- **DoubleLoopMemory** — изменение правила/эвристики/алгоритма (требует approval).

**DoubleLoopMemory** имеет более высокий приоритет при retrieval и всегда включается в `prefetch()` Strategy Memory.

### 3.3 Strategy Memory как First-Class Citizen

В Hermes MEMORY.md и USER.md — first-class.

У нас **Strategy Memory** должна быть ещё более приоритетной, чем episodic memory.

**Предложение:**
- Ввести `StrategyMemoryProvider` как отдельный MemoryProvider.
- При `prefetch()` Strategy Memory всегда загружается первой (с compression).
- `Strategist` агент всегда читает последние 10–15 DoubleLoopMemory записей перед планированием.

### 3.4 Wiki + Temporal Knowledge Graph

У нас уже есть wiki и memory файлы. Это преимущество.

**Мы интегрируем:**
- Wiki pages как **долгосрочное structured knowledge**.
- Временные связи (temporal edges) — когда решение было принято, почему, кто отменил.
- Backlinks + AlgorithmTrace (какой алгоритм создал/изменил эту страницу).

---

## 4. Архитектура Memory v2.0 (предлагаемая)

```
┌─────────────────────────────────────────────────────────────┐
│                    Pyrfor Memory Layer v2.0                  │
├─────────────────────────────────────────────────────────────┤
│  StrategyMemoryProvider  │  EpisodicMemoryProvider          │
│  (Double-Loop first)     │  (Event + Decision focused)      │
├─────────────────────────────────────────────────────────────┤
│                   ContextEngine (Pluggable)                  │
│  Summary | EntityGraph | DecisionRecord | ToolForge | Wiki   │
├─────────────────────────────────────────────────────────────┤
│                    Retrieval Layer                           │
│  AlgorithmAwareRetriever + ImpactScored + Temporal           │
├─────────────────────────────────────────────────────────────┤
│                    Storage Backends                          │
│  SQLite (FTS5) | PostgreSQL | Vector (pgvector / Weaviate)   │
│  + Wiki Git backend                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Что мы делаем уникального (никто не делает)

| Инновация | Описание | Почему это важно |
|-----------|----------|------------------|
| **AlgorithmImpact Edges** | Связи между memory-записями и алгоритмами, которые их создали/изменили | Алгоритмы могут видеть свою историю |
| **Double-Loop Prioritized Retrieval** | DoubleLoopMemory всегда загружается первым при prefetch | Самоулучшение становится естественным |
| **Wiki + Decision Provenance** | Каждая wiki-страница имеет DecisionRecord trail | Полная аудиторская цепочка знаний |
| **Skill/Algorithm Compounding** | Автоматическое предложение новых комбинаций алгоритмов на основе LessonsLearned | Эволюция системы |
| **Governed Compression** | Контекстная компрессия учитывает, каким алгоритмом эта память управляется | Сохраняет важное для конкретного алгоритма |

---

## 6. Roadmap интеграции Memory v2.0

| Milestone | Что делаем | Срок |
|-----------|------------|------|
| M3 | MemoryProvider interface + базовый EpisodicMemoryProvider | 2 недели |
| M4 | ContextEngine + первые 2 компрессора (Summary + DecisionRecord) | 3 недели |
| M6 | StrategyMemoryProvider + Double-Loop native storage | 3 недели |
| M8 | AlgorithmAwareRetriever + Impact Scored retrieval | 3 недели |
| M11 | Wiki + Temporal Knowledge Graph integration | 4 недели |
| M13 | Skill/Algorithm Compounding engine | 3 недели |
| M15 | Полная v2.0 + migration с v1 | 3 недели |

---

## 7. Заключение

Hermes — отличная memory-система.  
Pyrfor может стать **лучше**, если мы:

- Возьмём MemoryProvider + ContextEngine
- Добавим **Algorithm-Aware + Double-Loop Native** память
- Интегрируем существующую wiki + Decision Provenance
- Сделаем Strategy Memory приоритетнее episodic

Это даст нам **уникальное преимущество**: система, которая не просто помнит, а **помнит алгоритмически осознанно** и постоянно улучшает свои собственные правила.

---

Готов к обсуждению и итерациям.