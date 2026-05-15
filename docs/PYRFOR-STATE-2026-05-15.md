# Pyrfor — Состояние на 15.05.2026

**Актуализация: что построено, что в планах, кто что делает.**

---

## 1. Что УЖЕ готово (код в репозитории)

### Engine (packages/engine)

✅ 150+ модулей, 5900+ тестов
✅ Universal Engine — governed lifecycle: plan → research → execute → critique → postmortem → memory_persist
✅ 10 LLM-провайдеров с circuit breaker и fallback-роутингом
✅ Memory v2 — SQLite+FTS5 с governed reviews и contradiction detection
✅ Skills Registry — импорт, карантин, test → approve → vetted
✅ MCP Server + Client (stdio + SSE)
✅ A2A Protocol, ACP Bridge
✅ Subagent Spawner
✅ Run Ledger — канонический учёт всех запусков (P0-7 ✅)
✅ Completion Gate Engine — проверка условий завершения
✅ Ralph runner — обнаружение зависших агентов
✅ Permission engine + Approval Flow
✅ Trajectory Recorder — полная запись каждого run
✅ Postmortem phase + Incident Packets (уникальная фича)
✅ MetaCritic — авто-оценка improvement proposals
✅ Config + Hot-reload
✅ Circuit Breaker + Cost Tracker
✅ Self-Improvement OS:
  - SI1 ✅ Historian tag audit
  - SI2 ✅ Experience Library projection
  - SI3 ✅ Pattern Miner + Planner injection
  - SI4 ✅ Embedding retrieval + Optimizer specializations (4 типа)
  - SI5-8 ✅ M15 Self-Modification shell (hardened)
✅ Budget scope 'self_improvement'
✅ NeverEditableByOptimizer enforcement
✅ AG-UI emitter (P1-1 ✅)
✅ Миграция OpenClaw → Pyrfor: skills bridge + auto-test/approve

### Desktop (apps/pyrfor-ide)

✅ Tauri 2 + React + Monaco
✅ File tree, Editor, Chat, Terminal
✅ Trust Panel, Orchestration Panel
✅ Governed Strip (Runs, Blocked, Approvals в topbar)
✅ Color Token System (N1-1)
✅ Browser/Desktop unification (isTauriRuntime)
✅ Hamburger menu, clipboard paste, daemon readiness

### CLI

✅ `pyrfor concept` — governed run lifecycle
✅ `pyrfor migrate openclaw` — импорт с auto-test/approve
✅ `pyrfor skills test/approve/import`
✅ `pyrfor release check`

### Документы

✅ PYRFOR-MULTIAGENT-RESEARCH — 26 аналогов
✅ PYRFOR-IMPROVEMENT-PLAN — 37 задач P0-P3
✅ PYRFOR-SELF-IMPROVEMENT-ARCHITECTURE
✅ PYRFOR-SELF-IMPROVEMENT-ROADMAP-V2 (SI1-SI8)
✅ PYRFOR-ECOSYSTEM-VISION — 3 слоя, блочная модель
✅ PYRFOR-ECOSYSTEM-STRATEGY — конкурентный анализ, gap-анализ
✅ PYRFOR-IDEATHON-ANALYSIS — 8 внешних идей
✅ specs/BLOCK-MANIFEST-V1.md
✅ specs/MVP-RECONCILIATION-ACCEPTANCE.md
✅ specs/RU-COMPLIANCE-SCOPE.md

---

## 2. Что НЕ готово (P0 — критичное)

| ID | Задача | Почему важно |
|----|--------|-------------|
| P0-1 | Публичный GitHub | Саша не может показать продукт никому |
| P0-2 | One-command install (`npx @pyrfor/engine`) | Нельзя установить без клонирования репо |
| P0-3 | Sandbox (worktree/microsandbox) | `rm -rf /` пока теоретически возможен |
| P0-4 | OpenTelemetry GenAI | Нет observability для enterprise |
| P0-5 | MCP Streamable HTTP | Текущий стандарт MCP |
| P0-6 | SWE-bench прогон | Нет публичного benchmark |
| P0-8 | Worktree isolation | Subagent пока не изолирован |
| P0-9 | Permission ladder | Capability check не enforced везде |
| P0-10 | Cost guardrails end-to-end | Бюджет не enforced на всех уровнях |

**Плюс Phase A (Block SDK):** BLOCK-MANIFEST-V1 написан, runtime-лоадера нет.

---

## 3. Кто что делает

```
Саша
├─ Скидывает идеи, принимает стратегические решения
├─ Запускает Copilot на задачи
└─ Контролирует результат

Клод (я) 🐾
├─ Стратегия и архитектура
├─ Result Lock: verify → record → sync → commit
├─ Анализ внешних идей (ideathon)
├─ Gap-анализ и приоритизация
├─ Контроль качества (тесты, git log, diff review)
├─ Совет (многоагентный разбор)
└─ Семейный бот (отдельный трек)

Copilot
├─ Кодинг и имплементация
├─ Коммиты в pyrfor-dev
├─ Закрывает SQL-todos
└─ Работает по задачам от Саши
```

---

## 4. Цепочка приоритетов

```
Сейчас (эта неделя):
├─ Copilot: Phase 0.0 — walking skeleton Block SDK
│   └─ Фикстура КС-2/КС-3/1С, proto-lineage, human review
├─ Клод: /goal pattern в AGENTS.md + контроль
└─ Оба: проверить ночное совещание (03:00 сегодня)

Дальше (2 недели):
├─ P0-9: Permission Ladder
├─ P0-8: Worktree Isolation
├─ P0-10: Cost Guardrails
└─ Experience Library → замкнуть цикл postmortem

После (месяц):
├─ P0-1: Публичный GitHub + docs.pyrfor.dev
├─ P0-2: One-command install
├─ Phase B: Block Marketplace
└─ P0-6: SWE-bench прогон

Стратегически (3-6 месяцев):
├─ Индустриальные блоки (Estimate, Regulatory, Docs)
├─ Phase C: Протоколы (MCP Streamable, AG-UI full)
└─ Phase D: Enterprise (team features, RBAC)
```

---

## 5. Что изменилось сегодня

| Время | Что |
|-------|-----|
| Утро | Ночное совещание: диагностирована старая версия OpenClaw → исправлено |
| День | Семейный бот: 370 событий с годами, 86 праздников, 170 рождений |
| День | Copilot: SI1-SI8 + P0-7 lifecycle + AG-UI + migration skills |
| День | Copilot: v1.2 plan (STRATEGY/VISION обновлены, 3 specs созданы) |
| Вечер | Совет 3 агентов: Zenbu.js = P0 для Block SDK, разомкнутый цикл postmortem |
| Вечер | pnpm OpenClaw обновлён до 2026.5.12, nightly_meeting.sh укреплён |

---

## 6. Самое важное прямо сейчас

1. **Проверить ночное совещание сегодня в 03:00** — тест исправления
2. **Добавить /goal STOP RULES + DONE WHEN в AGENTS.md** — 30 минут, высокий impact
3. **Copilot: Phase 0.0 walking skeleton** — первый Block SDK с реальными данными Саши
4. **Замкнуть цикл Postmortem → Experience Library** — главный технический долг

---

*Документ актуален на 15.05.2026 11:00 МСК. Обновлять ежедневно.*
