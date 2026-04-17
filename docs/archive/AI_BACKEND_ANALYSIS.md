# CEOClaw AI Backend — Architecture Analysis

**Дата:** 2026-03-15
**Цель:** Сравнить CEOClaw backend с OpenClaw архитектурой

---

## ✅ Что УЖЕ ЕСТЬ в CEOClaw

### 1. AI Providers (`lib/ai/providers.ts`)

```
✅ OpenRouterProvider — Gemini 3.1, DeepSeek, Qwen
✅ ZAIProvider — GLM-5, GLM-4.7
✅ OpenAIProvider — GPT-5.2, GPT-4o
✅ AIRouter — авто-выбор провайдера, fallback
```

**API ключи уже в .env:**
- `ZAI_API_KEY=07b98bdc...`
- `OPENROUTER_API_KEY=sk-or-v1...`
- `DEFAULT_AI_PROVIDER=openrouter`

---

### 2. API Routes

```
✅ /api/ai/chat — AI chat endpoint
✅ /api/ai/runs — AI runs management
✅ /api/tasks — CRUD для задач
✅ /api/projects — CRUD для проектов
✅ /api/risks — CRUD для рисков
✅ ... (20+ других endpoints)
```

---

### 3. Memory System (`lib/memory/memory-manager.ts`)

```
✅ MemoryManager — CRUD операции
✅ ContextBuilder — сборка контекста для AI
✅ Validity tracking — отслеживание актуальности
✅ Search — поиск по памяти
✅ Export/Import — экспорт/импорт
```

**⚠️ Проблема:** Использует `localStorage`, а не Prisma!

---

### 4. Prisma Schema

```prisma
✅ Memory — долгосрочная память
✅ AgentSession — сессии AI агентов
✅ AIProvider — конфигурация провайдеров
✅ Skill — навыки
✅ Communication — логи общения
```

---

### 5. Agents (`lib/agents/`)

```
✅ orchestrator.ts — оркестратор
✅ worker-agents.ts — worker агенты
✅ agent-store.ts — хранилище
✅ base-agent.ts — базовый агент
✅ main-agent.ts — главный агент
```

---

## ❌ Чего НЕ ХВАТАЕТ

### 1. Memory → Prisma Integration

**Сейчас:** `localStorage` (только браузер)
**Нужно:** Prisma + SQLite/PostgreSQL

**Задача:**
- Создать `lib/memory/prisma-memory-manager.ts`
- API routes: `/api/memory/*`
- Гибридный подход (Prisma на сервере, localStorage как кэш)

---

### 2. Memory API Routes

```
❌ /api/memory — GET (list), POST (create)
❌ /api/memory/[id] — GET, PUT, DELETE
❌ /api/memory/search — POST (search)
❌ /api/memory/stats — GET (statistics)
```

---

### 3. Agent System Integration

**Сейчас:** Агенты есть, но не интегрированы с Memory
**Нужно:**
- Агенты читают/пишут в Prisma Memory
- AgentSession логируется в БД
- AIProvider читается из БД (с fallback на .env)

---

### 4. Frontend AI Chat Component

```
❌ components/ai/chat-panel.tsx — UI для общения с AI
❌ components/ai/message-list.tsx — список сообщений
❌ hooks/use-ai-chat.ts — hook для AI chat
```

---

### 5. Skills System

**Сейчас:** `Skill` model в Prisma, но не используется
**Нужно:**
- `/api/skills` — CRUD
- Интеграция с AI chat
- System prompts для навыков

---

## 🔄 Сравнение с OpenClaw

| Аспект | OpenClaw | CEOClaw | Gap |
|--------|----------|---------|-----|
| **AI Providers** | OpenClaw Gateway | AIRouter + 3 providers | ✅ OK |
| **Memory Storage** | MEMORY.md файлы | localStorage → Prisma | ⚠️ Нужно Prisma |
| **Memory API** | Нет (файлы) | Нужно создать | ❌ Missing |
| **Agents** | 7 агентов | Orchestrator + Workers | ✅ OK |
| **Agent Sessions** | Нет | AgentSession model | ✅ OK |
| **Context Builder** | MEMORY.md reader | contextBuilder | ✅ OK |
| **Skills** | skills/ папка | Skill model | ⚠️ Не интегрирован |
| **Frontend Chat** | Нет | Нужно создать | ❌ Missing |
| **Database** | Нет | SQLite/PostgreSQL | ✅ OK |

---

## 📋 План доработки

### Sprint 4: AI Integration (2-3 дня)

**Priority 1: Memory → Prisma**
1. Создать `lib/memory/prisma-memory-manager.ts`
2. API routes: `/api/memory/*`
3. Адаптировать `memory-manager.ts` для работы с Prisma

**Priority 2: Memory API**
1. `GET /api/memory` — список записей
2. `POST /api/memory` — создать запись
3. `PUT /api/memory/[id]` — обновить
4. `DELETE /api/memory/[id]` — удалить
5. `POST /api/memory/search` — поиск

**Priority 3: Frontend AI Chat**
1. `components/ai/chat-panel.tsx`
2. `hooks/use-ai-chat.ts`
3. Интеграция с `/api/ai/chat`

**Priority 4: Agent Integration**
1. Агенты читают из Prisma Memory
2. AgentSession логируется в БД
3. AIProvider из БД (fallback .env)

---

## 🎯 Результат

После доработки CEOClaw будет:

✅ **Standalone AI Dashboard** — работает без OpenClaw
✅ **Multi-provider** — OpenRouter, ZAI, OpenAI
✅ **Persistent Memory** — SQLite/PostgreSQL (не теряется)
✅ **Agent System** — 5+ AI агентов
✅ **Local + Cloud** — SQLite локально, PostgreSQL на Vercel
✅ **Skills** — расширяемые навыки через Prisma

---

## 🔧 Файлы для создания

```
lib/memory/prisma-memory-manager.ts  — Memory → Prisma
app/api/memory/route.ts              — GET, POST
app/api/memory/[id]/route.ts         — GET, PUT, DELETE
app/api/memory/search/route.ts       — POST (search)
components/ai/chat-panel.tsx         — UI для AI chat
components/ai/message-list.tsx       — Список сообщений
hooks/use-ai-chat.ts                 — Hook для AI chat
```

---

**Вывод:** CEOClaw уже имеет 80% AI backend. Осталось:
1. Прикрутить Memory к Prisma (вместо localStorage)
2. Создать Memory API routes
3. Создать Frontend AI Chat компонент

**Оценка времени:** 4-6 часов работы
