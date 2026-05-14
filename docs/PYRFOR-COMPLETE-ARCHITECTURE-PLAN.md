# Pyrfor — Полная Архитектура и План Разработки

**Дата:** 12 мая 2026
**Цель:** Всеобъемлющий план: архитектура, взаимодействие систем, десктоп-приложение, распределение работ.

---

## 1. Полная Архитектура Системы

### 1.1 Три уровня системы

```
┌─────────────────────────────────────────────────────────────┐
│  Уровень 1 — Управление (Стратегия + Контроль)              │
│                                                             │
│  ┌──────────────────────────────────┐                       │
│  │      Pyrfor Universal Engine     │                       │
│  │                                  │                       │
│  │  5 управляющих алгоритмов:       │                       │
│  │  • Strategic Planning (OODA)     │                       │
│  │  • Research + ToolCreation (TOC) │                       │
│  │  • Execution + QualityControl    │                       │
│  │  • LessonsLearned                │                       │
│  │  • SystemSelfImprovement         │                       │
│  │                                  │                       │
│  │  Memory v2.0:                    │                       │
│  │  • Strategy + Episodic +         │                       │
│  │    Algorithm-Aware + Double-Loop │                       │
│  │                                  │                       │
│  │  Safety: Tier Decider,           │                       │
│  │  DecisionVector, ApprovalFlow    │                       │
│  └──────────┬───────────────────────┘                       │
└─────────────┼─────────────────────────────────────────────┘
              │
    ┌─────────┼─────────┬──────────────┐
    ▼         ▼         ▼              ▼
┌───────┐ ┌───────┐ ┌───────┐  ┌───────────┐
│FreeCl.│ │Cursor │ │Copilot│  │Другие      │
│(кодинг)│ │(UI)   │ │(backend)│ │агенты     │
└───────┘ └───────┘ └───────┘  └───────────┘
    │         │         │            │
    └─────────┴─────────┴────────────┘
              │
┌─────────────┼─────────────────────────────────────────────┐
│  Уровень 3 — Результат (Проверка + Память + Улучшение)    │
│                                                             │
│  Pyrfor Engine: Verifier → PostMortem → LessonsLearned     │
│  → Double-Loop → Strategy Memory → Самоулучшение           │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Как распределяется работа

| Задача | Кто делает | Через что |
|--------|-----------|-----------|
| **Планирование** | Pyrfor Engine (Planner + Strategist) | PlanGraph |
| **Исследование** | Pyrfor Engine (Researcher) | Web search + MCP |
| **Кодинг** | FreeClaude | Pyrfor → FreeClaude API |
| **UI/Фронтенд** | Cursor | Прямая работа |
| **Backend/Engine** | Copilot | GitHub Copilot Workspace |
| **Тестирование** | FreeClaude + Pyrfor Engine (Verifier) | ToolForge |
| **Проверка** | Pyrfor Engine (Critic + Verifier) | Verifier Ensemble |
| **Память и уроки** | Pyrfor Engine (Historian + Strategist) | Strategy Memory v2.0 |
| **UI приложения** | Cursor (или Copilot) | См. раздел 2 |

---

## 2. Pyrfor Desktop — Полный План

### 2.1 Концепция

**Pyrfor Desktop — это пульт управления Pyrfor Universal Engine.**

Это НЕ IDE для кодинга (кодинг делает FreeClaude). Это приложение для:
- Общения с Engine
- Постановки задач
- Контроля прогресса
- Просмотра планов и результатов
- Управления агентами, памятью, настройками

### 2.2 Что УЖЕ есть в Pyrfor IDE

| Компонент | Статус | Оставить? | Комментарий |
|-----------|--------|-----------|-------------|
| FileTree | ✅ | ❌ Убрать | Не нужно для пульта управления |
| TabBar (редактор) | ✅ | ❌ Убрать | Не IDE, а пульт |
| Monaco Editor | ✅ | ❌ Убрать | Кодинг делает FreeClaude |
| Terminal (PTY) | ✅ | ❌ Убрать | Перенести в FreeClaude |
| Git Panel | ✅ | ❌ Убрать | Перенести в FreeClaude |
| DiffView | ✅ | ❌ Убрать | Перенести в FreeClaude |
| ChatPanel (SSE) | ✅ | ✅ Оставить | Основной интерфейс |
| WorkspaceSwitcher | ✅ | ✅ Оставить | Выбор проектов |
| SettingsModal | ✅ | ✅ Оставить | Настройки + провайдеры |
| OnboardingWizard | ✅ | ✅ Оставить | Первый запуск |
| UpdateNotifier | ✅ | ✅ Оставить | Автообновление |
| ConnectionStatus | ✅ | ✅ Оставить | Статус Engine |

### 2.3 Что взять из FreeClaude Desktop

| Компонент | Откуда | Зачем |
|-----------|--------|-------|
| NavigationRail | FreeClaude Desktop | Левый sidebar — удобная навигация |
| Icon-система | FreeClaude Desktop | Современные иконки вместо emoji |
| HomeCanvas | FreeClaude Desktop | Лендинг с проектами и быстрыми действиями |
| InspectorPanel | FreeClaude Desktop | Боковая панель с деталями |
| MarkdownMessage | FreeClaude Desktop | Красивый рендеринг сообщений |
| TopUtilityBar | FreeClaude Desktop | Верхняя панель с поиском и действиями |
| Адаптация стиля | FreeClaude Desktop | Общий современный визуальный стиль |

### 2.4 Что добавить нового

| Компонент | Описание | Приоритет |
|-----------|----------|-----------|
| **Agent Dashboard** | Список агентов, их статус, текущие задачи | Высокий |
| **Plan Viewer** | Просмотр текущего PlanGraph, прогресс по узлам | Высокий |
| **Memory Browser** | Просмотр Strategy Memory, записей, уроков | Средний |
| **Task Composer** | Удобная форма для постановки новой задачи | Высокий |
| **Progress Timeline** | Хронология выполнения задачи с этапами | Средний |
| **Approval Panel** | Запросы на подтверждение (ApprovalFlow) | Высокий |
| **Governance Monitor** | Статус Tier Decider, бюджетов, safety | Средний |
| **Shadcn/UI + Tailwind** | Современная дизайн-система | Высокий |
| **Голосовой ввод** | Отправка голосовых сообщений в чат | Средний |

### 2.5 Итоговый состав Pyrfor Desktop

```
┌──────────────────────────────────────────────┐
│  TopUtilityBar (поиск, профиль, настройки)    │
├────────┬─────────────────────────────────────┤
│        │                                     │
│ Nav    │  ┌─────────────────────────────┐    │
│ Rail   │  │  HomeCanvas / ChatPanel      │    │
│        │  │  (основная область)          │    │
│ • Home │  │                              │    │
│ • Chat │  │  - Чат с Engine              │    │
│ • Tasks│  │  - Agent Dashboard           │    │
│ • Plan │  │  - Plan Viewer              │    │
│ • Mem  │  │  - Task Composer            │    │
│ • Set  │  │  - Approval Panel           │    │
│        │  └─────────────────────────────┘    │
│        │                                     │
│        │  ┌─────────────────────────────┐    │
│        │  │  InspectorPanel (справа)     │    │
│        │  │  - Детали задачи             │    │
│        │  │  - Статус агентов            │    │
│        │  │  - Память / уроки           │    │
├────────┴─────────────────────────────────────┤
│  StatusBar (Engine статус, модель, бюджет)    │
└──────────────────────────────────────────────┘
```

**Технологии:** Tauri 2 + React 19 + TypeScript + Shadcn/UI + Tailwind

---

## 3. Распределение Работ

### 3.1 Что кому отдавать

| Исполнитель | Что делает | Почему |
|-------------|-----------|--------|
| **Copilot** | Pyrfor Engine (backend): алгоритмы, память, агенты, governance, ToolForge, M1–M17 | Силён в логике, архитектуре, безопасности |
| **Cursor** | Pyrfor Desktop (frontend): UI, Shadcn/UI, чат, дашборды, навигация | Силён в генерации красивого UI по Figma/описанию |
| **FreeClaude** | Кодинг-задачи по запросу Engine: написание кода, тесты, исправления | Основной кодинг-исполнитель |

### 3.2 Фазы (рекомендуемый порядок)

| Фаза | Кто | Что | Срок |
|------|-----|-----|------|
| **1** | Copilot | Завершить M1: Substrate + Gate Engine + Legacy baseline | 1–2 недели |
| **2** | Cursor | Начать Pyrfor Desktop: Tauri + Shadcn/UI + NavigationRail + чат | Параллельно с фазой 1 |
| **3** | Cursor | Добавить: Agent Dashboard, Task Composer, Approval Panel | 2–3 недели |
| **4** | Copilot | M3–M6: Memory v2.0, ContextEngine, Strategy Memory | 3–5 недель |
| **5** | Cursor + Copilot | Интеграция Desktop ↔ Engine (WebSocket/HTTP Gateway) | 2–3 недели |

### 3.3 Что НЕ трогаем

- FreeClaude Desktop — продолжает работать как есть
- Pyrfor IDE (текущий) — становится частью Pyrfor Desktop
- FreeClaude CLI — основной кодинг-инструмент

---

## 4. Старый Pyrfor IDE → Новый Pyrfor Desktop

### 4.1 Что переносим из старого в новый

| Из старого Pyrfor IDE | В новый Pyrfor Desktop |
|-----------------------|----------------------|
| ChatPanel (SSE стриминг) | Основной чат |
| SettingsModal (провайдеры, модели) | Настройки |
| OnboardingWizard | Первый запуск |
| WorkspaceSwitcher | Выбор проектов |
| ConnectionStatus | Статус Engine |
| UpdateNotifier | Автообновление |

### 4.2 Что НЕ переносим (оставляем во FreeClaude)

| Компонент | Почему не переносим |
|-----------|-------------------|
| Monaco Editor | Кодинг делает FreeClaude |
| Terminal (PTY) | Терминал во FreeClaude |
| Git Panel | Git во FreeClaude |
| DiffView | Диффы во FreeClaude |
| FileTree | Файлы во FreeClaude |

---

## 5. Конкретный План Действий

### Неделя 1 (12–18 мая)

| День | Кто | Задача |
|------|-----|--------|
| 12–13 | Copilot | M1 Substrate: CompletionGateEngine, DecisionRecord, Legacy baseline |
| 12–14 | Cursor | Создать новый Pyrfor Desktop: Tauri + Shadcn/UI + NavigationRail |
| 14–15 | Cursor | Перенести ChatPanel + Settings + Onboarding из старого IDE |
| 15–16 | Cursor | Добавить HomeCanvas (лендинг с проектами) |
| 16–18 | Cursor | Добавить Agent Dashboard (список агентов, статусы) |

### Неделя 2 (19–25 мая)

| День | Кто | Задача |
|------|-----|--------|
| 19–21 | Cursor | Task Composer + Approval Panel |
| 19–21 | Copilot | M4–M6: Memory Provider, ContextEngine |
| 22–24 | Cursor + Copilot | Интеграция Desktop ↔ Engine (WebSocket) |
| 24–25 | Cursor | Plan Viewer (базовый) |

### Неделя 3 (26 мая – 1 июня)

| День | Кто | Задача |
|------|-----|--------|
| 26–28 | Copilot | M7–M11: ToolForge, memory hardening |
| 26–28 | Cursor | Полировка UI, финальные правки |
| 29–31 | Cursor + Copilot | Интеграционное тестирование |
| 1 июня | Саша | Приёмка, обратная связь |

---

## 6. Ключевые решения (нужно подтверждение)

| № | Решение | Варианты | Рекомендация |
|---|---------|----------|--------------|
| 1 | **Pyrfor Desktop — новый проект или форк старого IDE?** | Новый / Форк | **Новый Tauri проект** (чище) |
| 2 | **Frontend: только Cursor или Cursor + Copilot?** | Только Cursor / Оба | **Cursor для UI, Copilot для Engine** |
| 3 | **FreeClaude Desktop: оставлять как есть?** | Да / Объединять | **Оставить как есть** |
| 4 | **Shadcn/UI + Tailwind: с нуля или миграция?** | С нуля / Миграция | **С нуля в новом проекте** |

---

## 7. Ожидаемый результат через 3 недели

- Работающий Pyrfor Engine (M1 Substrate)
- Красивый Pyrfor Desktop (Tauri + Shadcn/UI)
- Связь Desktop ↔ Engine
- Агенты видны, задачи ставятся, прогресс отслеживается
- FreeClaude Desktop продолжает работать для кодинга
- Система готова к ежедневному использованию

---

Готов к передаче Copilot и Cursor.