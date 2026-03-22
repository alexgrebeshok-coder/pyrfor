# CEOClaw — Memory

> AI-powered PM Dashboard с встроенными AI-агентами OpenClaw

---

## 🎯 Проект

**Суть:** Dashboard для управления проектами + интеграция с OpenClaw

**Цель:** Максимальная польза людям, open source, free forever

**Репозиторий:** `github.com/alexgrebeshok-coder/ceoclaw`

**Локальный путь:** `/Users/aleksandrgrebeshok/ceoclaw-dev`

---

## 🗄️ Database

**Проблема:** Neon PostgreSQL недоступен из РФ (порт 5432 заблокирован)

**Решение:** Две отдельные Prisma схемы

### Структура:

```
prisma/
├── schema.prisma          → активная схема Prisma (по умолчанию SQLite для локальной разработки)
├── schema.sqlite.prisma   → локальный SQLite-вариант, синхронизированный с основной схемой
└── schema.postgres.prisma → PostgreSQL-вариант с теми же моделями для production/CI

scripts/
└── switch-db.sh           → переключение активной schema.prisma между SQLite и PostgreSQL
```

### Различия:

| Аспект | SQLite | PostgreSQL |
|--------|--------|------------|
| Provider | `sqlite` | `postgresql` |
| URL | `DATABASE_URL` (локально обычно `file:./dev.db`) | `DATABASE_URL` + `DIRECT_URL` |
| Модели | Совпадают с `schema.prisma` | Совпадают с `schema.prisma` |
| Отличия | Только datasource/local runtime | Только datasource/production runtime |

### Команды:

```bash
# Локальная разработка
npm run db:sqlite
npx prisma db push
npm run dev

# Деплой на Vercel
npm run db:postgres
# Обновить .env с Neon credentials
npx prisma generate
npx prisma db push
npm run build
vercel --prod

# После деплоя — вернуться на SQLite
npm run db:sqlite
```

### ⚠️ Важно:

- `schema.prisma` должен оставаться реальным файлом, а split-схемы — синхронизированными по моделям
- **Не коммитить `.env`** с реальными credentials
- **Использовать Vercel Environment Variables** для продакшена

---

## 🏗️ Архитектура

### Tech Stack:

- **Frontend:** Next.js 15, React 19, TypeScript
- **Styling:** Tailwind CSS, Radix UI
- **Database:** Prisma ORM, SQLite/PostgreSQL
- **Auth:** NextAuth.js
- **Charts:** Recharts

### Структура проекта:

```
ceoclaw-dev/
├── app/                    # Next.js App Router
│   ├── (dashboard)/        # Dashboard pages
│   ├── api/                # API routes
│   └── ...
├── components/
│   ├── ui/                 # Base UI components
│   ├── layout/             # Layout components
│   ├── projects/           # Projects page
│   ├── tasks/              # Tasks page
│   ├── kanban/             # Kanban board
│   ├── risks/              # Risks page
│   ├── team/               # Team page
│   └── analytics/          # Analytics page
├── contexts/               # React contexts
├── hooks/                  # Custom hooks
├── lib/                    # Utilities
├── prisma/                 # Database schema
└── scripts/                # Utility scripts
```

---

## 📋 Sprint Status

| Sprint | Status | Описание |
|--------|--------|----------|
| Sprint 1 | ✅ Done | Dashboard UI |
| Sprint 2 | ✅ Done | Backend API |
| Sprint 3 | ✅ Done | UI Compact Redesign |
| Sprint 4 | ⏳ Pending | AI Integration |
| Sprint 5 | ⏳ Pending | Vercel Deploy |

---

## 🎨 Design System

### Compact UI Standard:

- **KPI cards:** `h-12 p-2 text-[10px]`
- **Tables:** `py-1.5 px-3 text-xs`
- **Charts:** `h-48` (192px)
- **Filters:** `h-10 text-xs !py-1.5`
- **Cards:** `p-3 text-sm`
- **Grid gap:** `gap-3` (12px)

### Цвета:

- Primary: `#3b82f6` (blue)
- Success: `#22c55e` (green)
- Warning: `#f59e0b` (amber)
- Danger: `#ef4444` (red)

### Шрифты:

- Inter (Google Fonts)

---

## 📝 Recent Commits

| Commit | Описание |
|--------|----------|
| `debc15b` | Fix duplicate key error in DomainPageHeader |
| `f2b4f9e` | Dual Prisma schemas (SQLite + PostgreSQL) |
| `ab4f0f2` | Switch Prisma to SQLite (Neon blocked) |
| `1ca52df` | Dashboard compact redesign |
| `99d9bd4` | Fix React key error in RisksPage |
| `c25389b` | Compact UI для 5 вкладок |

---

## 🔧 TODO

- [x] AI Backend Integration (Sprint 4)
  - [x] Prisma Memory Manager
  - [x] Memory API Routes
  - [x] AI Chat UI
- [ ] Deploy to Vercel
- [ ] Telegram Bot integration
- [ ] Multi-language (RU/EN/ZH)

---

## 🤖 Sprint 4: AI Backend (2026-03-15)

**Цель:** Сделать CEOClaw standalone AI dashboard

### ✅ Что сделано:

**Backend:**
- `lib/memory/prisma-memory-manager.ts` — Memory → Prisma
- `lib/db.ts` — Prisma client singleton
- `/api/memory/*` — CRUD для памяти (5 endpoints)
- `/api/ai/chat` — обновлён для Prisma

**Frontend:**
- `hooks/use-ai-chat.ts` — React hook для AI чата
- `components/ai/chat-panel.tsx` — Floating chat UI
- Интегрировано в `app/layout.tsx`

**API Endpoints:**
```
GET    /api/memory           — List memories
POST   /api/memory           — Create memory
GET    /api/memory/[id]      — Get by ID
PUT    /api/memory/[id]      — Update
DELETE /api/memory/[id]      — Delete
POST   /api/memory/search    — Search
GET    /api/memory/stats     — Statistics
POST   /api/ai/chat          — AI chat
GET    /api/ai/chat          — Providers list
```

**Commits:**
- `7ae699f` — Sprint 4 Part 1: Backend
- `1ab4a63` — Sprint 4 Part 2: UI

### 🎯 Результат:

CEOClaw теперь:
- ✅ Работает без OpenClaw
- ✅ Multi-provider AI (OpenRouter, ZAI, OpenAI)
- ✅ Persistent memory (SQLite/PostgreSQL)
- ✅ AI Chat UI на всех страницах
- ✅ Context-aware ответы

### ⏳ Следующие шаги:

1. Протестировать AI Chat в браузере
2. Задеплоить на Vercel
3. Telegram Bot integration

---

*Последнее обновление: 2026-03-15*
