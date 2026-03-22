# CEOClaw — AI-Powered Project Management Dashboard

**Version:** 1.0.0
**Status:** MVP Ready (March 2026)
**Repository:** https://github.com/alexgrebeshok-coder/ceoclaw
**License:** MIT (Open Source)

---

## 📋 Оглавление

- [О проекте](#о-проекте)
- [Архитектура](#архитектура)
- [Технологии](#технологии)
- [Функционал](#функционал)
- [AI-интеграция](#ai-интеграция)
- [Установка](#установка)
- [Использование](#использование)
- [Roadmap](#roadmap)

---

## 🎯 О проекте

**CEOClaw** — это AI-powered PM Dashboard с встроенными AI-агентами OpenClaw для управления проектами, портфелем и аналитикой.

### Миссия
Демократизация AI для управления проектами. Максимальная польза людям, open source, free forever.

### Целевая аудитория
- Project Managers
- PMO Directors
- Executive Teams
- Construction & Infrastructure Companies

### Ключевые преимущества
- 🤖 **Built-in AI Agents** — OpenClaw Gateway интегрирован
- 📊 **Real-time Analytics** — EVM, risks, resources
- 🌐 **Multi-Language** — RU/EN/ZH
- 🎨 **Apple-Style Design** — Inter font, #3b82f6 accent
- 🔒 **Local-First** — Работает офлайн с локальными AI моделями

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      CEOClaw Dashboard                       │
│                   (Next.js 15 + React 19)                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                     ↓                     ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Frontend    │    │   Backend     │    │  AI Engine    │
│   (React)     │    │  (Next.js)    │    │  (OpenClaw)   │
└───────────────┘    └───────────────┘    └───────────────┘
        ↓                     ↓                     ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Components   │    │    Prisma     │    │  Local Model  │
│  - Dashboard  │    │   SQLite/     │    │   (MLX)       │
│  - Projects   │    │   PostgreSQL  │    │   v10/v11     │
│  - Kanban     │    │               │    │               │
│  - Gantt      │    │               │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
                              ↓
                    ┌───────────────┐
                    │  Fallback     │
                    │  ZAI /        │
                    │  OpenRouter   │
                    └───────────────┘
```

### Fallback Chain (AI)

```
/api/ai/chat
  ↓
local-model (v10/v11, localhost:8000, 10s timeout)
  ↓ (если ошибка)
ZAI (glm-5, api.z.ai)
  ↓ (если ошибка)
OpenRouter (gpt-4o-mini)
```

---

## 💻 Технологии

### Frontend
- **Next.js 15.5.12** — App Router, RSC
- **React 19** — Server Components
- **TypeScript 5** — Strict mode
- **Tailwind CSS 4** — Styling
- **shadcn/ui** — Components
- **Recharts** — Charts
- **Lucide Icons** — Icons

### Backend
- **Next.js API Routes** — REST API
- **Prisma ORM** — Database
- **SQLite** — Development
- **PostgreSQL (Neon)** — Production

### AI/ML
- **OpenClaw Gateway** — AI orchestration
- **Qwen 2.5 3B (MLX)** — Local model
- **ZAI GLM-5** — Cloud fallback
- **OpenRouter** — Cloud fallback
- **RAG System** — Memory + Full-text search

### Infrastructure
- **Vercel** — Deployment
- **GitHub Actions** — CI/CD
- **Playwright** — E2E testing
- **Vitest** — Unit testing

---

## ⚙️ Функционал

### 📊 Dashboard
- Portfolio overview
- Project status cards
- KPI metrics
- Recent activity feed
- Quick actions panel

### 📁 Projects
- Project CRUD
- Status tracking (planning/active/on-hold/completed)
- Progress visualization
- Budget & timeline
- Team assignment

### 📋 Tasks
- Kanban board
- Task priorities
- Assignees
- Due dates
- Dependencies

### 📅 Timeline
- Gantt chart
- Milestones
- Critical path
- Resource allocation

### 📈 Analytics
- EVM metrics (SPI, CPI, EAC, VAC)
- Risk analysis
- Budget tracking
- Team performance
- Portfolio health

### 🤖 AI Features
- **AI Chat** — Natural language queries
- **Auto-routing** — Agent selection by context
- **EVM Calculator** — Automatic SPI/CPI calculation
- **Status Reports** — Auto-generated updates
- **Risk Detection** — Proactive warnings

### 🌐 Multi-Language
- 🇷🇺 Russian (default)
- 🇬🇧 English
- 🇨🇳 Chinese

---

## 🤖 AI-интеграция

### Local Model Server

**Endpoint:** `http://localhost:8000`

**Models:**
- `v10` — General queries, status reports
- `v11` — EVM calculations, analytics

**API Format:** OpenAI-compatible

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "v11",
    "messages": [{"role": "user", "content": "Рассчитай SPI"}]
  }'
```

### Dashboard API

**Endpoint:** `/api/ai/chat`

**Request:**
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Рассчитай SPI если BCWS=120, BCWP=100, ACWP=110"}
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "provider": "local",
  "model": "v11",
  "response": "**EVM Анализ**\n    SPI: 0.83 (отставание 17%)\n    CPI: 0.91 (перерасход 9%)\n    Рекомендация: ⚠️ Требуются корректирующие меры"
}
```

### AI Agents

Dashboard поддерживает 8 AI агентов:

1. **Auto-routing** — Автовыбор агента по контексту
2. **PMO Director** — Стратегические решения
3. **Portfolio Analyst** — Аналитика портфеля
4. **Execution Planner** — Планирование
5. **Status Agent** — Статус-апдейты
6. **Risk Explorer** — Анализ рисков
7. **Budget Controller** — Финансовый контроль
8. **Document Author** — Документация

---

## 🚀 Установка

### Требования
- Node.js 22+
- Python 3.9+ (для local model)
- macOS / Linux / Windows

### Локальная разработка

```bash
# 1. Клонировать репозиторий
git clone https://github.com/alexgrebeshok-coder/ceoclaw.git
cd ceoclaw

# 2. Установить зависимости
npm install

# 3. Настроить окружение
cp .env.example .env.local
# Отредактировать .env.local

# 4. Инициализировать БД
npm run db:sqlite
npx prisma db push
npx prisma generate

# 5. Запустить Dashboard
npm run dev

# 6. Запустить Local Model Server (другой терминал)
cd ~/.openclaw/workspace
python3 tools/local-model-server.py --port 8000 --preload v11

# 7. Открыть в браузере
open http://localhost:3000
```

### Продакшн (Vercel)

```bash
# 1. Переключиться на PostgreSQL
npm run db:postgres

# 2. Обновить .env с Neon credentials

# 3. Сгенерировать Prisma Client
npx prisma generate

# 4. Задеплоить схему
npx prisma db push

# 5. Деплой на Vercel
vercel --prod
```

---

## 📖 Использование

### AI Chat

Откройте: **http://localhost:3000/chat**

**Примеры запросов:**

```
Рассчитай SPI и CPI для проекта Реконструкция набережной
Какие проекты в зоне риска?
Статус портфеля
Покажи бюджет на март
Критические задачи на этой неделе
```

### EVM Анализ

```
Рассчитай EVM метрики:
- BCWS (план): 120
- BCWP (освоено): 100
- ACWP (затраты): 110
```

**Результат:**
```
SPI = 0.83 (отставание 17%)
CPI = 0.91 (перерасход 9%)
EAC = 121
VAC = -1
Рекомендация: ⚠️ Требуются корректирующие меры
```

### API Integration

```javascript
// JavaScript/TypeScript
const response = await fetch('http://localhost:3000/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Статус портфеля' }]
  })
});

const data = await response.json();
console.log(data.response);
```

---

## 🗺️ Roadmap

### Phase 1: MVP ✅ (March 2026)
- [x] Dashboard UI
- [x] Projects CRUD
- [x] Kanban board
- [x] AI Chat integration
- [x] Local model server
- [x] Multi-language (RU/EN/ZH)
- [x] Mobile responsive

### Phase 2: Backend API (Q2 2026)
- [ ] Full REST API
- [ ] Authentication (NextAuth)
- [ ] Role-based access
- [ ] Webhooks
- [ ] API documentation

### Phase 3: AI-PMO Features (Q3 2026)
- [ ] Vector search (pgvector)
- [ ] Predictive analytics
- [ ] Auto-scheduling
- [ ] Resource optimization
- [ ] Risk prediction

### Phase 4: Integrations (Q4 2026)
- [ ] Telegram bot
- [ ] Yandex 360 (OAuth, Disk)
- [ ] 1C:PM integration
- [ ] Jira import
- [ ] Excel export

### Phase 5: Desktop App (2027)
- [ ] Electron/Tauri wrapper
- [ ] Offline mode
- [ ] Local file storage
- [ ] System notifications

---

## 📂 Структура проекта

```
ceoclaw-dev/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   │   ├── ai/           # AI endpoints
│   │   ├── projects/     # Projects CRUD
│   │   └── ...
│   ├── (dashboard)/      # Dashboard pages
│   ├── chat/             # AI Chat page
│   └── ...
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── dashboard/        # Dashboard widgets
│   ├── projects/         # Project components
│   └── ...
├── lib/                   # Utilities
│   ├── ai/               # AI integration
│   │   ├── provider-adapter.ts
│   │   ├── rag-system.ts
│   │   └── ...
│   ├── prisma.ts         # Database client
│   └── ...
├── prisma/               # Database schema
│   ├── schema.sqlite.prisma
│   ├── schema.postgres.prisma
│   └── dev.db
├── messages/             # i18n translations
│   ├── ru.json
│   ├── en.json
│   └── zh.json
├── docs/                 # Documentation
├── tools/                # Scripts
│   ├── local-model-server.py
│   ├── test-local-model.py
│   └── ...
└── public/              # Static assets
```

---

## 🔧 Конфигурация

### Environment Variables

```bash
# Database
DATABASE_URL="file:./dev.db"                    # SQLite (dev)
# DATABASE_URL="postgresql://..."               # PostgreSQL (prod)

# AI Providers
OPENROUTER_API_KEY="sk-or-v1-..."              # OpenRouter
ZAI_API_KEY="..."                               # ZAI (glm-5)

# App
NEXTAUTH_SECRET="dev-secret-..."               # Auth secret
NEXTAUTH_URL="http://localhost:3000"           # App URL
CEOCLAW_SKIP_AUTH="true"                       # Skip auth (dev)

# AI Configuration
AI_PROVIDER_PRIORITY="local-model,zai"         # Provider priority
```

### Local Model Server

```bash
# Start with preload
python3 tools/local-model-server.py --port 8000 --preload v11

# Health check
curl http://localhost:8000/health
# {"status":"ok","models_loaded":["v11"],"available_models":["v10","v11"]}
```

---

## 🧪 Тестирование

### Unit Tests

```bash
npm run test
```

### E2E Tests

```bash
npm run test:e2e
```

### API Tests

```bash
# Health check
curl http://localhost:3000/api/health

# AI Chat
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Тест"}]}'
```

---

## 📊 Статистика проекта

**Codebase:**
- TypeScript files: 200+
- React components: 80+
- API routes: 30+
- Database models: 15+

**Dependencies:**
- Production: 45
- Development: 35

**Test Coverage:**
- Unit: 60%
- E2E: 40%

---

## 👥 Команда

**Разработчик:** Александр Гребешок
**AI Assistant:** OpenClaw (Claude + Codex + GPT)

---

## 📄 Лицензия

MIT License — Open Source, Free Forever

---

## 🔗 Ссылки

- **Repository:** https://github.com/alexgrebeshok-coder/ceoclaw
- **Documentation:** `/docs`
- **Issues:** https://github.com/alexgrebeshok-coder/ceoclaw/issues
- **Pull Request:** https://github.com/alexgrebeshok-coder/ceoclaw/pull/7

---

## 🙏 Благодарности

- **OpenClaw** — AI orchestration platform
- **shadcn/ui** — Beautiful components
- **Vercel** — Hosting platform
- **Neon** — PostgreSQL database

---

**Created:** March 21, 2026
**Last Updated:** March 21, 2026
**Version:** 1.0.0

---

*CEOClaw — AI-powered PM Dashboard for the future of project management.* 🚀
