# CEOClaw Phase 3 — Промты для кодирующей модели

> **Кто читает этот файл:** кодинговый агент (Sonnet/Haiku), получает один промпт за раз.  
> **Ревьюер:** Claude Opus (проверяет результат после каждого этапа).  
> **Проект:** `/Users/aleksandrgrebeshok/ceoclaw-dev/`  
> **Дата:** 2026-03-17  
> **Предыдущая фаза:** Phase 2 (7/7 промтов выполнено)

---

## Контекст проекта

CEOClaw — AI-powered PM Dashboard на Next.js 15.  
- SSE streaming работает через `chatStream()` в `OpenRouterProvider`
- Multi-agent система: MainAgent → 6 worker agents
- Compact context: ~800 токенов вместо ~8000
- SQLite (dev), 4 проекта, 30+ задач

### Важные файлы

| Файл | Назначение |
|------|-----------|
| `app/api/ai/chat/route.ts` | AI chat endpoint (SSE + non-stream) |
| `hooks/use-ai-chat.ts` | React SSE streaming hook |
| `lib/ai/providers.ts` | Все AI провайдеры + AIRouter |
| `lib/agents/orchestrator.ts` | Singleton AgentOrchestrator |
| `lib/agents/base-agent.ts` | Abstract BaseAgent |
| `lib/agents/worker-agents.ts` | 6 worker agent классов |
| `lib/logger.ts` | Structured logger |

### Проверка после каждого промта

```bash
# 1. TypeScript (не должно быть НОВЫХ ошибок)
cd /Users/aleksandrgrebeshok/ceoclaw-dev
npx tsc --noEmit 2>&1 | grep "\.ts(" | grep -v "telegram\|evm-\|bottleneck\|resource/calc\|resource/optim\|speech-to-text\|mock-data\|chat-layout\|chat-sidebar\|bot\.ts" | head -5
# Ожидание: пусто

# 2. Build
npm run build 2>&1 | tail -5
# Ожидание: ✓ Compiled

# 3. Streaming тест (если dev server запущен)
curl -s -N --max-time 20 -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Привет","stream":true}' | head -8
# Ожидание: data: {"type":"agent",...} потом data: {"type":"chunk",...}
```

---
---

# PROMPT 1 — Bugfixes + AIRouter Singleton

## Задача

Исправить 5 проблем найденных при code review. Это улучшит стабильность и уберёт resource leaks.

## Проблема 1: `new AIRouter()` создаётся в 8 местах

**Текущее состояние:**
- `lib/agents/base-agent.ts` строка 57: `this.router = new AIRouter();` — вызывается для КАЖДОГО из 7 агентов
- `app/api/ai/chat/route.ts` строка 110: `const router = new AIRouter();` — в streaming path
- `app/api/ai/chat/route.ts` строка 210: `const router = new AIRouter();` — в GET handler

Каждый `new AIRouter()` создаёт заново Map провайдеров, парсит env vars, инициализирует все provider instances.

**Решение:**

### Шаг 1.1: Добавить `getRouter()` singleton в `lib/ai/providers.ts`

В конце файла `lib/ai/providers.ts` уже может быть `_routerInstance`. Найди его и убедись, что есть **экспортируемая** функция:

```typescript
// Singleton router — reused across requests
let _routerInstance: AIRouter | null = null;

export function getRouter(): AIRouter {
  if (!_routerInstance) {
    _routerInstance = new AIRouter();
  }
  return _routerInstance;
}
```

Если `getRouter()` уже есть но не экспортируется — добавь `export`.
Если его нет — добавь в конец файла.

### Шаг 1.2: Заменить `new AIRouter()` в `base-agent.ts`

В файле `lib/agents/base-agent.ts`:

```typescript
// БЫЛО (строка 57):
this.router = new AIRouter();

// СТАЛО:
import { getRouter } from '@/lib/ai/providers';
// ...
this.router = getRouter();
```

Убедись что import `AIRouter` заменён на import `getRouter`. Тип `router` должен остаться `AIRouter` (свойство класса).

### Шаг 1.3: Заменить `new AIRouter()` в `route.ts`

В файле `app/api/ai/chat/route.ts`:

```typescript
// БЫЛО (строка 6):
import { AIRouter } from '@/lib/ai/providers';

// СТАЛО:
import { getRouter } from '@/lib/ai/providers';

// БЫЛО (строка 110, streaming path):
const router = new AIRouter();

// СТАЛО:
const router = getRouter();

// БЫЛО (строка 210, GET handler):
const router = new AIRouter();

// СТАЛО:
const router = getRouter();
```

---

## Проблема 2: Reader не отменяется при unmount

**Файл:** `hooks/use-ai-chat.ts`

**Текущее:** Hook делает `fetch()` и читает `response.body.getReader()`, но если компонент размонтируется во время streaming — reader и fetch продолжают работать, вызывая memory leak.

**Решение:**

Добавить `AbortController` в `sendMessage`:

```typescript
// В начале sendMessage (после `setError(null);` на строке 47):
const abortController = new AbortController();

// В fetch options (строка 57-67) добавить signal:
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal: abortController.signal,     // ← ДОБАВИТЬ
  body: JSON.stringify({
    message: content,
    stream: true,
    provider: options.provider,
    model: options.model,
    projectId: options.projectId,
  }),
});

// В finally блок (после строки 122) добавить abort:
} finally {
  setIsLoading(false);
  abortController.abort();  // ← ДОБАВИТЬ: cleanup fetch if still running
}
```

Также: в catch блок добавить проверку на abort error чтобы не показывать ошибку при размонтировании:

```typescript
} catch (err) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    // Component unmounted — not a real error
    return;
  }
  // ... остальная обработка ошибок как сейчас
```

---

## Проблема 3: Memory save ошибки проглатываются молча

**Файл:** `app/api/ai/chat/route.ts`, строки 179-181

**Текущее:**
```typescript
} catch {
  // Memory save failure is non-critical
}
```

**Решение:**
```typescript
} catch (memErr) {
  logger.warn('Memory save failed', { error: memErr instanceof Error ? memErr.message : String(memErr) });
}
```

---

## Проблема 4: `chatStream!` non-null assertion

**Файл:** `app/api/ai/chat/route.ts`, строка 127

**Текущее:**
```typescript
for await (const chunk of providerInstance.chatStream!(messages, { model: modelToUse })) {
```

`chatStream!` — если по какой-то причине `getStreamingProvider()` вернул провайдер без `chatStream`, это упадёт с TypeError.

**Решение:**
```typescript
if (!providerInstance.chatStream) {
  return NextResponse.json({ success: false, error: 'Provider does not support streaming' }, { status: 400 });
}
for await (const chunk of providerInstance.chatStream(messages, { model: modelToUse })) {
```

Вставить проверку ПЕРЕД строкой 127 (после `const modelToUse = ...`).

---

## Проблема 5: `agentId` не валидируется в streaming path

**Файл:** `app/api/ai/chat/route.ts`

**Текущее:** строка 105 делает `getOrchestrator().getAgent(selectedAgentId)` и проверяет на null — это OK.

Но на строке 101 для non-streaming path `selectedAgentId` передаётся в `orchestrator.execute()` без проверки. Если агент не найден — ошибка глубоко внутри orchestrator.

**Решение:** Перенести проверку агента ПЕРЕД `if (stream)` блоком:

```typescript
// После строки 101:
const selectedAgentId = agentId || smartSelector.selectAgent(message);

// ДОБАВИТЬ проверку:
const orchestrator = getOrchestrator();
if (!orchestrator.getAgent(selectedAgentId)) {
  return NextResponse.json(
    { success: false, error: `Agent '${selectedAgentId}' not found` },
    { status: 404 }
  );
}

// SSE Streaming path
if (stream) {
  const agent = orchestrator.getAgent(selectedAgentId)!; // safe — checked above
  // ... rest of streaming code
```

И убрать дублирующийся `const orchestrator = getOrchestrator();` ниже (строка ~155).

---

## Результат на выходе

После этого промта:
- [ ] `getRouter()` singleton экспортируется из `lib/ai/providers.ts`
- [ ] `base-agent.ts` использует `getRouter()` вместо `new AIRouter()`
- [ ] `route.ts` использует `getRouter()` вместо `new AIRouter()` (2 места)
- [ ] `use-ai-chat.ts` имеет `AbortController` для cleanup
- [ ] Memory save failure логируется через `logger.warn`
- [ ] `chatStream!` заменён на проверку + early return
- [ ] agentId валидируется до streaming/non-streaming path
- [ ] TypeScript: 0 новых ошибок
- [ ] Build: проходит
- [ ] Streaming: работает

---
---

# PROMPT 2 — Analytics с реальными данными

## Задача

Страница Analytics (`app/analytics/page.tsx`) уже имеет 5 табов и 20+ компонентов. Но некоторые чарты могут использовать mock данные или не подключены к API. Нужно:

1. Проверить что ВСЕ графики получают данные из реальных API endpoints
2. Исправить если какие-то компоненты используют hardcoded данные

## Контекст

Существующие API endpoints для аналитики:
- `GET /api/analytics/overview` — сводка по проектам
- `GET /api/analytics/team-performance` — метрики команды
- `GET /api/analytics/plan-fact` — план vs факт
- `GET /api/projects` — проекты с бюджетом
- `GET /api/risks` — риски
- `GET /api/tasks` — задачи
- `GET /api/team` — команда

## Шаг 1: Аудит текущих данных в чартах

Открой каждый analytics компонент и проверь, откуда берутся данные:

```bash
# Найти все analytics компоненты
find /Users/aleksandrgrebeshok/ceoclaw-dev/components/analytics -name "*.tsx" | sort

# Проверить: используют ли они SWR/fetch или hardcoded данные?
grep -rn "useSWR\|fetch(" /Users/aleksandrgrebeshok/ceoclaw-dev/components/analytics/ | head -30
grep -rn "const.*data.*=.*\[" /Users/aleksandrgrebeshok/ceoclaw-dev/components/analytics/ | head -20
```

## Шаг 2: Для каждого компонента с hardcoded данными

Замени на SWR hook. Пример:

```typescript
// БЫЛО:
const data = [
  { name: 'Project A', value: 100 },
  { name: 'Project B', value: 200 },
];

// СТАЛО:
import useSWR from 'swr';
const fetcher = (url: string) => fetch(url).then(r => r.json());

function BudgetChart() {
  const { data, isLoading } = useSWR('/api/projects', fetcher);
  
  if (isLoading) return <Skeleton className="h-64" />;
  
  const chartData = (data?.projects ?? []).map((p: any) => ({
    name: p.name,
    planned: p.budget?.planned ?? 0,
    spent: p.budget?.spent ?? 0,
  }));
  
  return <BarChart data={chartData}>...</BarChart>;
}
```

## Шаг 3: Dashboard Overview — подключить к `/api/analytics/overview`

Файл `components/analytics/analytics-dashboard.tsx` или `components/analytics/analytics-page.tsx` — убедись что главный dashboard компонент вызывает:

```typescript
const { data: overview } = useSWR('/api/analytics/overview', fetcher);
```

И передаёт данные в дочерние компоненты.

## Шаг 4: Проверить что lazy loading не сломан

Файл `app/analytics/page.tsx` должен по-прежнему использовать `dynamic()`:

```typescript
const BudgetChart = dynamic(() => import('@/components/analytics/evm/budget-chart'), {
  loading: () => <Skeleton className="h-64" />,
  ssr: false,
});
```

## Шаг 5: Добавить error boundaries для чартов

Если чарт падает (например, API вернуло неожиданную структуру), не должна падать вся страница:

```typescript
// components/analytics/chart-error-boundary.tsx
'use client';
import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; }

export class ChartErrorBoundary extends Component<Props, State> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Ошибка загрузки графика
        </div>
      );
    }
    return this.props.children;
  }
}
```

Обернуть каждый `dynamic()` чарт в `<ChartErrorBoundary>`.

## Результат на выходе

- [ ] Все analytics компоненты получают данные из API (не hardcoded)
- [ ] `ChartErrorBoundary` создан и оборачивает все чарты
- [ ] Dashboard overview подключён к `/api/analytics/overview`
- [ ] Lazy loading (`dynamic()`) работает
- [ ] Страница `/analytics` отображает реальные данные из БД
- [ ] Build проходит

---
---

# PROMPT 3 — Mobile Responsive

## Задача

Основной layout (`components/layout/app-shell.tsx`) уже имеет responsive sidebar с drawer на мобильных. Нужно довести до ума:

1. Проверить и исправить компоненты, которые ломаются на маленьких экранах
2. Убедиться что все grid layouts адаптивны
3. Таблицы с данными должны скроллиться горизонтально

## Шаг 1: Аудит текущего responsive состояния

```bash
# Проверить app-shell — уже responsive?
grep -n "lg:\|md:\|sm:\|hidden" /Users/aleksandrgrebeshok/ceoclaw-dev/components/layout/app-shell.tsx | head -20

# Найти компоненты БЕЗ responsive классов
grep -rL "md:\|sm:\|lg:" /Users/aleksandrgrebeshok/ceoclaw-dev/components/dashboard/*.tsx 2>/dev/null
grep -rL "md:\|sm:\|lg:" /Users/aleksandrgrebeshok/ceoclaw-dev/components/projects/*.tsx 2>/dev/null
```

## Шаг 2: Исправить grid layouts

Найди все `grid-cols-` без responsive prefix:

```bash
grep -rn "grid-cols-[2-9]" /Users/aleksandrgrebeshok/ceoclaw-dev/components/ | grep -v "md:\|lg:\|sm:" | grep -v node_modules
```

Для каждого найденного — добавить responsive breakpoints:

```typescript
// БЫЛО:
className="grid grid-cols-3 gap-4"

// СТАЛО:
className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
```

## Шаг 3: Таблицы — горизонтальный скролл

Найди все `<table>` или table-подобные компоненты:

```bash
grep -rn "<table\|<Table\|<thead" /Users/aleksandrgrebeshok/ceoclaw-dev/components/ | head -20
```

Обернуть каждую таблицу в scrollable контейнер:

```typescript
// БЫЛО:
<table className="...">

// СТАЛО:
<div className="overflow-x-auto">
  <table className="...">
```

## Шаг 4: Dashboard cards — адаптивный layout

Файл `components/dashboard/dashboard-home.tsx` (или аналог):

```typescript
// KPI карточки — 1 колонка на мобиле, 2 на планшете, 4 на десктопе:
className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"

// Графики — полная ширина на мобиле:
className="grid grid-cols-1 lg:grid-cols-2 gap-6"
```

## Шаг 5: Chat input — fixed bottom на мобиле

Если chat input не зафиксирован внизу на мобильных — добавить:

```typescript
className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t lg:relative lg:border-0"
```

## Шаг 6: Текст — предотвратить overflow

```bash
grep -rn "text-2xl\|text-3xl\|text-4xl" /Users/aleksandrgrebeshok/ceoclaw-dev/components/ | grep -v "sm:\|md:\|lg:" | head -10
```

Большие заголовки должны уменьшаться на мобиле:

```typescript
// БЫЛО:
className="text-3xl font-bold"

// СТАЛО:  
className="text-xl sm:text-2xl lg:text-3xl font-bold"
```

## Результат на выходе

- [ ] Все grid layouts имеют responsive breakpoints (1→2→3/4 колонки)
- [ ] Таблицы обёрнуты в `overflow-x-auto`
- [ ] Dashboard cards адаптивны
- [ ] Заголовки уменьшаются на мобиле
- [ ] Chat input удобен на мобиле
- [ ] Build проходит
- [ ] Визуально корректно на 375px (iPhone) и 768px (iPad)

---
---

# PROMPT 4 — Telegram Bot Production

## Задача

Telegram bot уже имеет ~70% кода: `lib/telegram/bot.ts`, 6 команд в `lib/telegram/commands/`, webhook endpoint. Нужно:

1. Исправить TS ошибки в telegram файлах
2. Добавить AI команду `/ai [вопрос]`
3. Сделать webhook production-ready

## Шаг 1: Исправить TS ошибки

```bash
npx tsc --noEmit 2>&1 | grep "telegram" | head -15
```

Ожидаемые ошибки:
- `bot.ts(21,1)`: `Modifiers cannot appear here` — `export` перед `const`?
- `bot.ts(21,36)`: `TELEGRAM_BOT_TOKEN` может быть `undefined`
- `add-task.ts(29,5)`: `dueDate` обязательно в `TaskCreateInput`
- `tasks.ts(9,39)`: Property `name` not on Task type

Для каждой ошибки — исправить:

```typescript
// bot.ts — добавить проверку токена:
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.warn('TELEGRAM_BOT_TOKEN not set — bot disabled');
  // export пустые функции
}

// add-task.ts — добавить dueDate:
await prisma.task.create({
  data: {
    title,
    projectId,
    status: 'todo',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 дней
    priority: 'medium',
  },
});

// tasks.ts — использовать правильное поле (title вместо name):
const taskLines = tasks.map(t => `• [${t.status}] ${t.title}`);
```

## Шаг 2: Добавить `/ai` команду

Создать файл `lib/telegram/commands/ai.ts`:

```typescript
import { getOrchestrator } from '@/lib/agents/orchestrator';
import { loadServerAIContext } from '@/lib/ai/server-context';

export async function handleAI(question: string): Promise<string> {
  if (!question.trim()) {
    return 'Использование: /ai <ваш вопрос>\nПример: /ai Какой статус проекта ЧЭМК?';
  }

  try {
    const context = await loadServerAIContext({});
    const orchestrator = getOrchestrator();
    const result = await orchestrator.execute('quick-research', question, context);
    
    if (result.result.success) {
      return result.result.content || 'Нет ответа';
    }
    return `Ошибка: ${result.result.error || 'Неизвестная ошибка'}`;
  } catch (err) {
    return `AI недоступен: ${err instanceof Error ? err.message : String(err)}`;
  }
}
```

Зарегистрировать в `bot.ts` и в `webhook/route.ts`:

```typescript
// В executeCommand() или аналоге:
case '/ai':
  const aiResponse = await handleAI(text.replace('/ai', '').trim());
  await sendMessage(chatId, aiResponse);
  break;
```

## Шаг 3: Обновить webhook endpoint

Файл `app/api/telegram/webhook/route.ts` — проверить что:

1. Есть проверка `TELEGRAM_WEBHOOK_SECRET`
2. Ответы отправляются правильно
3. Ошибки не ломают webhook (всегда 200 OK для Telegram)

```typescript
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    
    const update = await req.json();
    // ... handle update
    
    return NextResponse.json({ ok: true }); // ALWAYS 200 for Telegram
  } catch (err) {
    logger.error('Telegram webhook error', { error: String(err) });
    return NextResponse.json({ ok: true }); // Still 200 — don't retry
  }
}
```

## Результат на выходе

- [ ] 0 TS ошибок в `lib/telegram/` файлах
- [ ] `/ai` команда работает через AgentOrchestrator
- [ ] Webhook endpoint production-ready (всегда 200 OK)
- [ ] Все 7 команд: /start, /help, /status, /projects, /tasks, /add_task, /ai
- [ ] Build проходит

---
---

# PROMPT 5 — Vercel Deploy

## Задача

Подготовить проект к деплою на Vercel. Текущая конфигурация почти готова.

## Шаг 1: Проверить `vercel.json`

```bash
cat /Users/aleksandrgrebeshok/ceoclaw-dev/vercel.json
```

Должен содержать:
```json
{
  "buildCommand": "npm run vercel-build",
  "framework": "nextjs"
}
```

Если `buildCommand` указывает на `npm run build` — заменить на `npm run vercel-build` (он копирует postgres schema, генерирует Prisma Client и запускает seed; guarded `migrate deploy` включается отдельно).

## Шаг 2: Проверить `vercel-build` скрипт

В `package.json` должен быть guarded production-prepare flow:
```json
"prisma:prepare:production": "bash ./scripts/prepare-production-prisma.sh",
"vercel-build": "npm run prisma:prepare:production && npm run seed:production && next build"
```

Проверить что:
1. `prisma/schema.postgres.prisma` существует
2. `scripts/prepare-production-prisma.sh` существует
3. `seed:production` скрипт существует и работает
4. `next build` проходит

```bash
ls /Users/aleksandrgrebeshok/ceoclaw-dev/prisma/schema.postgres.prisma
cat /Users/aleksandrgrebeshok/ceoclaw-dev/scripts/prepare-production-prisma.sh
cat /Users/aleksandrgrebeshok/ceoclaw-dev/prisma/seed-production.ts | head -10
```

## Шаг 3: Создать `.env.example` с полным списком переменных

Файл `/Users/aleksandrgrebeshok/ceoclaw-dev/.env.example`:

```bash
# === Database (Vercel Postgres или Supabase) ===
DATABASE_URL="postgresql://user:pass@host:5432/ceoclaw"
DIRECT_URL="postgresql://user:pass@host:5432/ceoclaw"

# === Auth ===
NEXTAUTH_SECRET="your-secret-here"
NEXTAUTH_URL="https://your-domain.vercel.app"

# === AI Providers (минимум один обязателен) ===
OPENROUTER_API_KEY="sk-or-v1-..."

# === Российские AI провайдеры (опционально) ===
GIGACHAT_CLIENT_ID=""
GIGACHAT_CLIENT_SECRET=""
YANDEXGPT_API_KEY=""
YANDEX_FOLDER_ID=""

# === Другие AI провайдеры (опционально) ===
AIJORA_API_KEY=""
POLZA_API_KEY=""
BOTHUB_API_KEY=""
ZAI_API_KEY=""
OPENAI_API_KEY=""

# === Telegram (опционально) ===
TELEGRAM_BOT_TOKEN=""
TELEGRAM_WEBHOOK_SECRET=""

# === Runtime ===
LOG_LEVEL="info"
DEFAULT_AI_PROVIDER="openrouter"
# Production runtime always expects live data.
# For demo setups refer to `docs/mock-data.md`; the runtime flag `APP_DATA_MODE` has been retired.
```

## Шаг 4: Проверить что `next.config.mjs` совместим с Vercel

```bash
cat /Users/aleksandrgrebeshok/ceoclaw-dev/next.config.mjs
```

Убедиться:
- `output` НЕ установлен в `'standalone'` (Vercel сам решает)
- `serverExternalPackages` содержит `['@libsql/client']` если используется Turso
- `images.domains` содержит нужные домены

## Шаг 5: Тест build с postgres schema

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev
# Проверить guarded production prepare
npm run prisma:prepare:production
npm run build
# Вернуть локальную схему при необходимости
npm run db:sqlite
```

## Результат на выходе

- [ ] `vercel.json` указывает на `vercel-build`
- [ ] `.env.example` создан с полным списком переменных
- [ ] Build с postgres schema проходит
- [ ] `next.config.mjs` совместим с Vercel
- [ ] README.md обновлён секцией "Deploy to Vercel"

---
---

# PROMPT 6 — Tauri Desktop App (Опционально, сложный)

## Задача

Папка `src-tauri/` уже существует с `tauri.conf.json` и `main.rs`. Нужно:

1. Обновить до Tauri v2 (если ещё v1)
2. Добавить `@tauri-apps/api` в frontend
3. Сделать system tray с кнопками
4. Добавить desktop notifications

## Предварительная проверка

```bash
# Проверить версию Tauri
cat /Users/aleksandrgrebeshok/ceoclaw-dev/src-tauri/Cargo.toml | grep tauri
cat /Users/aleksandrgrebeshok/ceoclaw-dev/src-tauri/tauri.conf.json | head -5

# Проверить наличие Rust
rustc --version 2>&1
cargo --version 2>&1
```

**ЕСЛИ Rust не установлен — СТОП.** Сообщить ревьюеру что Tauri требует Rust toolchain.

## Шаг 1: Установить frontend зависимости

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev
npm install @tauri-apps/api @tauri-apps/cli
```

## Шаг 2: Обновить `main.rs` (минимальный)

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // System tray, notifications, etc.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Шаг 3: Добавить scripts в package.json

```json
{
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build"
}
```

## Шаг 4: Тест запуска

```bash
npm run tauri:dev
```

Должно открыться нативное окно с Next.js приложением внутри.

## Результат на выходе

- [ ] `@tauri-apps/api` установлен
- [ ] `src-tauri/` работает с Tauri v2
- [ ] `npm run tauri:dev` открывает приложение
- [ ] System tray работает
- [ ] Или: сообщение "Rust не установлен, Tauri пропущен"

---
---

# Порядок выполнения и зависимости

```
PROMPT 1 (Bugfixes)      — НЕТ зависимостей, делать первым
    │
    ▼
PROMPT 2 (Analytics)     — после Prompt 1 (используют getRouter)
    │
    ▼
PROMPT 3 (Mobile)        — после Prompt 2 (чтобы analytics тоже были responsive)
    │
    ▼
PROMPT 4 (Telegram)      — независим, можно параллельно с 2-3
    │
    ▼
PROMPT 5 (Deploy)        — последним (после всех фиксов)
    │
    ▼
PROMPT 6 (Tauri)         — опционально, полностью независим
```

## Как отдавать ревьюеру

После каждого промта:

1. Показать diff: `git diff --stat`
2. Показать TS проверку: `npx tsc --noEmit 2>&1 | grep "\.ts(" | grep -v "telegram\|evm-\|bottleneck\|resource/calc\|resource/optim\|speech-to-text\|mock-data\|chat-layout\|chat-sidebar\|bot\.ts" | wc -l`
3. Показать build: `npm run build 2>&1 | tail -3`
4. Показать streaming тест (для промтов 1, 4): `curl -s -N --max-time 15 -X POST http://localhost:3000/api/ai/chat -H "Content-Type: application/json" -d '{"message":"Привет","stream":true}' | head -6`

Ревьюер проверит результат и даст OK или попросит исправления.
