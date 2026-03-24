# CEOClaw — Архитектура

**Дата:** 24 марта 2026  
**Версия:** 0.1.0 (web app package; architecture snapshot)  
**Автор:** Alexander Grebeshok + OpenClaw (AI)

---

## 📋 Обзор проекта

**CEOClaw** — AI-powered visual project management dashboard для управления портфелем проектов. Next.js 15 full-stack приложение с интегрированной multi-agent AI системой и real-time SSE стримингом.

### Цель проекта
- Визуальный dashboard для портфеля проектов (7 проектов, 30+ задач)
- AI-ассистент с multi-agent архитектурой (реальные ответы, не mock)
- Real-time streaming ответов AI
- Мультиязычный интерфейс (RU/EN/ZH)

---

## 🏗 Архитектура

### Технологический стек

```
┌─────────────────────────────────────────────────────────┐
│            FRONTEND (Next.js 15 + React 18)              │
│  Tailwind CSS + Radix UI + Recharts + SSE streaming hook │
│  Lazy-loaded charts + incremental rendering              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 BACKEND (Next.js API Routes)             │
│  POST /api/ai/chat (stream + non-stream)                │
│  Prisma ORM + NextAuth.js                               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   MULTI-AGENT AI LAYER                  │
│  AgentOrchestrator (singleton)                          │
│  MainAgent → [Research, Planner, Reviewer, Writer]      │
│  Compact context (~800 tokens vs ~8000)                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│               AI PROVIDERS (multi-provider)              │
│  OpenRouter (streaming, gemma-3-*:free, fallback chain) │
│  GigaChat (OAuth2, 32K context, RF доступен)            │
│  YandexGPT (Api-Key, cloud.yandex.net, RF доступен)     │
│  + AIJora, Polza.ai, Bothub, ZAI, OpenAI                │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    DATABASE LAYER                       │
│  SQLite default schema / Postgres deploy path + Prisma │
└─────────────────────────────────────────────────────────┘
```

### Статистика проекта

| Метрика | Значение |
|--------|----------|
| API Endpoints | 131 |
| React Components | 189 |
| Library Modules | 268 |
| Database Models | 40+ |
| Automated Tests | 109 passing (`npm run test:run`) |

---

## 📁 Структура проекта

```
ceoclaw-dev/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── ai/chat/route.ts      # AI chat endpoint (SSE streaming)
│   │   ├── projects/             # Project CRUD
│   │   ├── tasks/                # Task management
│   │   ├── team/                 # Team members
│   │   ├── risks/                # Risk management
│   │   └── ...                   # Other endpoints
│   │
│   ├── projects/                 # Projects page
│   ├── tasks/                    # Tasks page
│   ├── team/                     # Team page
│   ├── analytics/                # Analytics page
│   ├── chat/                     # AI Chat page
│   └── kanban/                   # Kanban board
│
├── components/                   # React components
│   ├── ui/                       # Base UI (Radix-based)
│   ├── dashboard/                # Dashboard widgets
│   ├── analytics/                # Charts (lazy-loaded)
│   └── chat/                     # AI Chat UI
│
├── lib/
│   ├── agents/
│   │   ├── orchestrator.ts       # Singleton AgentOrchestrator
│   │   ├── base-agent.ts         # Abstract BaseAgent (getSystemPrompt, buildMessages)
│   │   ├── main-agent.ts         # MainAgent (routing)
│   │   └── worker-agents.ts      # Research, Planner, Reviewer, Writer, Coder, Worker
│   ├── ai/
│   │   ├── providers.ts          # All AI providers (OpenRouter, GigaChat, YandexGPT, ...)
│   │   ├── server-context.ts     # loadServerAIContext (Prisma → AgentContext)
│   │   └── memory.ts             # Episodic memory system
│   ├── logger.ts                 # Structured logger (LOG_LEVEL env var)
│   └── prisma.ts                 # Prisma singleton
│
├── hooks/
│   └── use-ai-chat.ts            # SSE streaming hook
│
└── prisma/
    ├── schema.prisma             # 40+ models
    └── seed-demo.ts              # 7 projects, 30 tasks, 7 members, 7 risks
```

---

## 🔄 Data Flow

### 1. AI Chat — SSE Streaming

```
User types message
    │
    ▼
hooks/use-ai-chat.ts  (stream: true)
    │
    ▼  POST /api/ai/chat  {"message":"...", "stream":true}
    │
    ▼
app/api/ai/chat/route.ts
    ├── buildCompactContext() → ~800 token summary из Prisma
    ├── getOrchestrator().execute(message, context)  [singleton]
    │     └── MainAgent → ResearchAgent / PlannerAgent / ...
    └── getStreamingProvider().chatStream(messages)
          └── OpenRouterProvider._streamModel()
                ├── Tries google/gemma-3-27b-it:free
                ├── Fallback → google/gemma-3-12b-it:free
                └── Fallback → google/gemma-3-4b-it:free
    │
    ▼  text/event-stream
data: {"type":"agent","agent":{"id":"main","name":"Main"}}
data: {"type":"chunk","content":"Добр"}
data: {"type":"chunk","content":"ый"}
...
data: [DONE]
    │
    ▼
use-ai-chat.ts: собирает chunks → обновляет UI постепенно
```

### 2. Client → API → Database

```
React Component
    │
    ▼
useSWR Hook (lib/hooks/use-api.ts)
    │
    ▼
API Route (/app/api/*/route.ts)
    │
    ▼
Prisma Client (lib/prisma.ts)
    │
    ▼
SQLite / PostgreSQL
```

---

## 🤖 AI Integration

### Multi-Agent Архитектура

```typescript
// lib/agents/orchestrator.ts — Singleton
let _orchestratorInstance: AgentOrchestrator | null = null;
export function getOrchestrator(): AgentOrchestrator {
  return _orchestratorInstance ??= new AgentOrchestrator();
}

// lib/agents/base-agent.ts — Abstract base
abstract class BaseAgent {
  abstract getSystemPrompt(context?: AgentContext): string;
  
  buildMessages(userMessage: string, context?: AgentContext): Message[] {
    return [
      { role: 'system', content: this.getSystemPrompt(context) },
      { role: 'user', content: userMessage }
    ];
  }
  
  getModel(): string  // for streaming provider selection
  getProvider(): string
}
```

### Context Compression

AI agents получают сжатый контекст (~800 токен против ~8000 при полном JSON):

```typescript
// app/api/ai/chat/route.ts
function buildCompactContext(projects, tasks, team, risks): AgentContext {
  const summary = [
    `## Проекты (${projects.length})`,
    ...projects.map(p => `- ${p.name} | ${p.status} | ${p.progress}%`),
    `## Задачи (${tasks.length})`,
    ...tasks.slice(0, 10).map(t => `- [${t.status}] ${t.title}`),
    // ...
  ].join('\n');

  return { projectId: '...', projectName: '...', metadata: { summary, ... } };
}
```

### AI Providers — Приоритет

| Приоритет | Провайдер | Модели | Стриминг | Регион |
|-----------|-----------|--------|----------|--------|
| 1 | GigaChat | GigaChat, Plus, Pro | ❌ | 🇷🇺 РФ |
| 2 | YandexGPT | yandexgpt-lite, yandexgpt | ❌ | 🇷🇺 РФ |
| 3 | AIJora | gpt-4o-mini, claude-3-5-sonnet | ❌ | Агрегатор РФ |
| 4 | Polza.ai | gpt-4o, claude-3.5-sonnet | ❌ | Агрегатор РФ |
| 5 | **OpenRouter** | gemma-3-27b:free → 12b → 4b | ✅ | Global |
| 6 | Bothub | gpt-4o-mini, yandexgpt | ❌ | Агрегатор РФ |
| 7 | ZAI | glm-5 | ❌ | Global |
| 8 | OpenAI | gpt-5.2, gpt-4o | ❌ | Global |

**Streaming**: Только OpenRouter (`chatStream()` с fallback chain 27b→12b→4b на 429).

### DNS Cache

Решение Next.js/undici IPv6 bug для Node.js fetch:

```typescript
// lib/ai/providers.ts
const _dnsCache = new Map<string, { ip: string; expiresAt: number }>();

async function getCachedIPv4(hostname: string): Promise<string> {
  // dns.resolve4() явно запрашивает IPv4
  // Cache TTL: 5 минут
}
// httpsPost и chatStream используют getCachedIPv4('openrouter.ai')
```

---

## 🗄️ Database Schema

### Core Models

```
┌─────────────┐       ┌─────────────┐
│   Project   │──1:N──│    Task     │
└─────────────┘       └─────────────┘
       │                     │
       │ 1:N                │ N:1
       ▼                     ▼
┌─────────────┐       ┌─────────────┐
│    Risk     │       │ TeamMember  │
└─────────────┘       └─────────────┘
```

### Key Relationships

- **Project** → Tasks (1:N), Risks (1:N), Documents (1:N), Milestones (1:N)
- **Task** → Project (N:1), Assignee (N:1), Dependencies (N:N)
- **TeamMember** → Tasks (1:N), Projects (N:M)
- **Risk** → Project (N:1), Owner (N:1)

---

## 🎨 Frontend Architecture

### State Management

```
React Context
├── ThemeContext (dark/light/system)
├── LocaleContext (ru/en/zh + translations)
└── AIContext (chat state — используется hooks/use-ai-chat.ts)

Data Fetching
└── SWR (lib/hooks/use-api.ts)
    ├── useProjects()
    ├── useTasks()
    ├── useTeam()
    └── useRisks()
```

### Chart Lazy Loading

Все тяжёлые Recharts компоненты загружаются по требованию:

```typescript
// app/analytics/page.tsx
const BudgetChart = dynamic(() => import('@/components/analytics/evm/budget-chart'), {
  loading: () => <Skeleton className="h-64" />,
  ssr: false,
});
```

---

## 🔌 API Endpoints

### AI Chat

| Method | Endpoint | Params | Description |
|--------|----------|--------|-------------|
| POST | /api/ai/chat | `{message, stream?, agentId?}` | AI chat (SSE if stream:true) |
| GET | /api/ai/chat | — | Providers + agents list |

### CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | /api/projects | Projects list / create |
| GET/PUT/DELETE | /api/projects/:id | Project detail |
| GET/POST | /api/tasks | Tasks list / create |
| GET/POST | /api/team | Team members |
| GET/POST | /api/risks | Risks |

### Response Format

```typescript
// ✅ Все API возвращают объекты
{ "projects": [...], "total": 10 }
{ "tasks": [...], "total": 5 }
```

---

## 📝 Logging

```typescript
// lib/logger.ts — Structured logger
import { logger } from '@/lib/logger';

logger.debug('Streaming start', { model, agentId });
logger.info('Request complete', { tokens: 800 });
logger.warn('Model fallback', { from: '27b', to: '12b' });
logger.error('Provider failed', { error });
```

**Управление уровнем:** `LOG_LEVEL=debug|info|warn|error|silent` в `.env`  
По умолчанию: `debug` в dev, `info` в production.

---

## 🚀 Deployment

### Environment Variables

```bash
# Local development
DATABASE_URL="postgresql://..."               # Postgres runtime
DIRECT_URL="postgresql://..."                 # direct/non-pooling URL
CEOCLAW_SKIP_AUTH="true"                      # dev only
NEXTAUTH_URL="http://localhost:3000"

# Hosted preview / production
DATABASE_URL="postgresql://..."               # Postgres runtime
DIRECT_URL="postgresql://..."                 # direct/non-pooling URL
POSTGRES_PRISMA_URL="postgresql://..."        # optional Vercel/system env
POSTGRES_URL="postgresql://..."               # optional Vercel/system env

# Auth
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="https://your-app.vercel.app"

# AI Providers (RF-first)
GIGACHAT_CLIENT_ID="..."
GIGACHAT_CLIENT_SECRET="..."
YANDEXGPT_API_KEY="..."
YANDEX_FOLDER_ID="b1g..."

# AI Providers (Global)
OPENROUTER_API_KEY="sk-or-v1-..."
AIJORA_API_KEY="..."
POLZA_API_KEY="..."
BOTHUB_API_KEY="..."
ZAI_API_KEY="..."
OPENAI_API_KEY="sk-..."

# Logger
LOG_LEVEL="info"                              # debug|info|warn|error|silent

# Runtime
# Live-only runtime (see docs/mock-data.md for the retired `APP_DATA_MODE` demo instructions)
DEFAULT_AI_PROVIDER="openrouter"              # override
```

> Production configurations no longer set `APP_DATA_MODE`. Keep `docs/mock-data.md` as the single source of truth for any legacy demo flows.

### Local Development

```bash
npm run dev
# → http://localhost:3000
# → AI: POST /api/ai/chat {"message":"Привет","stream":true}

npx prisma db seed   # Reset + seed 7 projects, 30 tasks
```

### Vercel Deployment

```bash
# 1. Configure Postgres env vars in Vercel
# 2. Prepare Prisma for Postgres
npm run prisma:prepare:production

# 3. Validate locally
npm run build

# 4. Deploy
vercel --prod

# 5. Run post-deploy smoke
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

---

## 🐛 Known Issues / Technical Debt

### Foundation items still open

- Checked-in Prisma default remains SQLite; production still relies on Postgres build-time preparation.
- `prisma migrate deploy` is intentionally disabled by default until the Postgres baseline is rebuilt.
- CI still defaults to `SKIP_E2E=true` for Playwright.
- `npm audit --omit=dev` currently reports 2 production vulnerabilities (`jspdf` critical, `next` moderate).
- ESLint warning backlog remains and `next lint` currently exits non-zero.

### Streaming ограничения

- Только OpenRouter (`OpenRouterProvider`) имеет `chatStream()` реализацию
- GigaChat и YandexGPT — только non-streaming (`chat()`)
- Gemma free models: rate limit 429 → fallback chain 27b→12b→4b

### Bundle

- `next.config.mjs`: `typescript.ignoreBuildErrors: true`, `eslint.ignoreDuringBuilds: true`
- Recharts chunks по 4.5MB → частично решено через `dynamic()` lazy loading

---

## 🔒 Security

### Fixed Vulnerabilities

1. **Telegram Token в Git** → Moved to env var
2. **Auth Bypass** → `CEOCLAW_SKIP_AUTH=true` только для dev
3. **GigaChat SSL** → `rejectUnauthorized: false` (Sber self-signed cert — accepted risk)

### Remaining Issues

- ⚠️ npm vulnerabilities in `xlsx` package (HIGH)
- ⚠️ 172 `any` usages in TypeScript
- ⚠️ GigaChat/YandexGPT — нет API ключей, не протестированы

---

## 📊 Performance (Phase 2)

| Метрика | До (Phase 1) | После (Phase 2) |
|--------|----------|---------|
| AI Context | ~8000 tokens JSON | ~800 tokens compact text |
| AgentOrchestrator | new per request | Singleton |
| DNS resolve | per request | 5min cache |
| First AI token | 3-12s (blocking) | <1s (streaming) |
| Chart loading | eager (4.5MB) | lazy (dynamic) |
| Console.log | 652 calls | Structured logger |
