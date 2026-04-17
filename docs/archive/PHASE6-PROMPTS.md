# CEOClaw Phase 6 — Промты для кодирующей модели

> **Кто читает этот файл:** кодинговый агент (Sonnet/Haiku), получает один промпт за раз.  
> **Ревьюер:** Claude Opus / GPT-5 (проверяет результат после каждого этапа).  
> **Проект:** `/Users/aleksandrgrebeshok/ceoclaw-dev/`  
> **Дата:** 2026-03-18  
> **Предыдущие фазы:** Phase 1-5 выполнены (v0.2.2)  
> **Фокус Phase 6:** Production-readiness — AI reliability + Settings + Deploy

---

## Контекст проекта

CEOClaw — AI-powered PM Dashboard (Next.js 15 + Prisma + PostgreSQL).  
Phase 5 заложила основы (Sentry, AI tools, Gantt API), но ряд критичных вещей остался незакрытым.

### Текущее состояние (факты)

| Область | Статус | Детали |
|---------|--------|--------|
| `shouldServeMockData()` | ✅ retired | Всегда возвращает `false` |
| `usingMockData` в API routes | 🔴 dead code | 30+ веток в `app/api/**` — недостижимы, но загрязняют код |
| Sentry config | ✅ files exist | `instrumentation.ts`, `instrumentation-client.ts`, `lib/sentry/config.ts` — не закоммичены |
| `hooks/use-ai-chat.ts` | 🔴 incomplete | Игнорирует `toolCall` и `meta` события SSE |
| `contexts/preferences-context.tsx` | 🔴 client-only | localStorage, нет backend API |
| `components/gantt/gantt-page.tsx` | 🟡 partial | Берёт из dashboard context, не из API |
| `.env.production.example` | 🔴 wrong | Написано "database optional / demo mode" |
| `vercel-build` script | 🟡 risky | `prisma db push` вместо `migrate deploy` |

### Важные файлы

| Файл | Назначение |
|------|-----------|
| `app/api/ai/chat/route.ts` | AI chat endpoint — SSE streaming + tool execution |
| `hooks/use-ai-chat.ts` | React SSE streaming hook |
| `lib/ai/tools/index.ts` | Tool registry, `allTools`, `executeTool()` |
| `lib/ai/tools/types.ts` | `AITool`, `ToolResult` interfaces |
| `lib/server/runtime-mode.ts` | `getServerRuntimeState()`, `shouldServeMockData()` |
| `contexts/preferences-context.tsx` | App preferences (сейчас localStorage-only) |
| `components/gantt/gantt-page.tsx` | Gantt страница (сейчас dashboard context) |
| `app/api/gantt/dependencies/route.ts` | Gantt dependencies API |
| `app/api/projects/[id]/gantt/route.ts` | Per-project Gantt tasks API |
| `prisma/schema.prisma` | Main schema |
| `package.json` → `vercel-build` | Deploy build script |

### Проверка после КАЖДОГО промта

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev

# 1. TypeScript (0 ошибок)
npx tsc --noEmit 2>&1 | tail -5

# 2. Build
npm run build 2>&1 | tail -5

# 3. Tests
npx vitest run 2>&1 | tail -10
```

---

---

# PROMPT A — Стабилизация + Коммит незакоммиченных изменений

## Задача

Текущий worktree содержит незакоммиченные улучшения (Sentry, live-first docs/env, runtime helpers).  
Цель этого промпта: проверить что всё корректно, исправить оставшиеся противоречия и закоммитить.

## Шаг 1: Аудит незакоммиченных изменений

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev
git status -sb
git diff --stat
```

## Шаг 2: Исправить `.env.production.example`

Файл `/.env.production.example` содержит ошибочный комментарий "database optional / demo mode works without it".  
Исправить секцию DATABASE:

```bash
# Найти
grep -n "optional\|demo mode works" .env.production.example
```

**БЫЛО:**
```
# DATABASE (optional - demo mode works without it)
```

**СТАЛО:**
```
# DATABASE (required for production)
```

Также раскомментировать примеры DATABASE_URL (убрать `#` перед переменными):

```env
# ===========================================
# DATABASE (required — PostgreSQL via Neon or Supabase)
# ===========================================
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRES_PRISMA_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRES_URL_NON_POOLING=postgresql://user:pass@host/db?sslmode=require
```

## Шаг 3: Проверить согласованность Sentry файлов

Убедиться что файлы существуют:

```bash
ls -la instrumentation.ts instrumentation-client.ts lib/sentry/config.ts
```

Проверить содержимое `lib/sentry/config.ts` — должен читать `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` без hard-coded значений.

Если `next.config.mjs` НЕ использует `withSentryConfig` — добавить (опционально, только если `@sentry/nextjs` поддерживает текущую версию Next.js):

```javascript
// Если версия совместима:
import { withSentryConfig } from "@sentry/nextjs";
// ... existing nextConfig ...
export default withSentryConfig(nextConfig, { silent: true });
```

Если возникают проблемы совместимости — оставить без `withSentryConfig`, только сами `.config.ts` файлы.

## Шаг 4: Проверить что `ARCHITECTURE.md` не содержит `APP_DATA_MODE` как обязательную переменную

```bash
grep -n "APP_DATA_MODE" ARCHITECTURE.md
```

Если есть — заменить примеры на комментарий:
```
# APP_DATA_MODE is deprecated. Runtime is always live. See docs/mock-data.md.
```

## Шаг 5: Запустить проверки

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10
```

Все проверки должны пройти зелёно.

## Шаг 6: Закоммитить

```bash
git add -A
git commit -m "chore: commit live-first docs, Sentry integration, env cleanup

- Fix .env.production.example: database is required, not optional
- Add Sentry config files (client/server/lib)
- Update ARCHITECTURE.md: APP_DATA_MODE deprecated
- Align README/DEPLOY with live-only runtime

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Результат на выходе

- [ ] `git status` показывает чистый worktree
- [ ] `.env.production.example` говорит что DATABASE обязательна
- [ ] Sentry файлы закоммичены
- [ ] Build + tsc + tests проходят

---

---

# PROMPT B — Удаление dead mock-data кода

## Задача

В `app/api/**` существует ~30+ ветвей `if (runtime.usingMockData) { ... }`.  
Поскольку `shouldServeMockData()` всегда возвращает `false`, эти ветви **никогда не выполняются**.  
Их нужно удалить чтобы код был честным и читаемым.

## Контекст

`lib/server/runtime-mode.ts` строка 60-63:
```typescript
export function shouldServeMockData(): boolean {
  // Mock data mode has been retired; always require a live database.
  return false;
}
```

Это значит что `runtime.usingMockData` ВСЕГДА `false`.

## Шаг 1: Найти все API routes с mock branches

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev
grep -rn "usingMockData" app/api --include="*.ts" -l
```

Файлы для обработки (из аудита):
- `app/api/tasks/route.ts`
- `app/api/tasks/[id]/route.ts`
- `app/api/tasks/[id]/dependencies/route.ts`
- `app/api/tasks/[id]/move/route.ts`
- `app/api/tasks/[id]/reschedule/route.ts`
- `app/api/tasks/reorder/route.ts`
- `app/api/tasks/[id]/dependencies/[dependencyId]/route.ts`
- `app/api/projects/route.ts`
- `app/api/projects/[id]/route.ts`
- `app/api/calendar/events/route.ts`
- `app/api/gantt/dependencies/route.ts`
- `app/api/team/route.ts`
- `app/api/team/[id]/route.ts`
- `app/api/risks/route.ts`
- `app/api/risks/[id]/route.ts`
- `app/api/boards/route.ts`
- `app/api/boards/[id]/route.ts`
- `app/api/milestones/route.ts`
- `app/api/milestones/[id]/route.ts`
- `app/api/analytics/**`
- `app/api/notifications/**`
- `app/api/documents/**`
- `app/api/time-entries/**`

## Шаг 2: Паттерн удаления

Для КАЖДОГО файла — найти и удалить блок вида:

```typescript
// БЫЛО:
if (runtime.usingMockData) {
  const { getMockXxx } = await import("@/lib/mock-data");
  // ... возврат mock данных ...
  return NextResponse.json(mockData);
}

// СТАЛО: (удалить весь блок целиком)
```

После удаления убедиться что:
- Import из `@/lib/mock-data` тоже удалён если больше не используется
- `getServerRuntimeState()` вызов остаётся (нужен для `databaseConfigured` check)
- Оставшийся `if (!runtime.databaseConfigured)` остаётся нетронутым

### Пример для `app/api/tasks/route.ts`:

```typescript
// БЫЛО:
const runtime = getServerRuntimeState();
if (runtime.usingMockData) {
  const { getMockTasks } = await import("@/lib/mock-data");
  return NextResponse.json({ tasks: getMockTasks(), total: getMockTasks().length });
}
if (!runtime.databaseConfigured) {
  return databaseUnavailable(runtime.dataMode);
}

// СТАЛО:
const runtime = getServerRuntimeState();
if (!runtime.databaseConfigured) {
  return databaseUnavailable(runtime.dataMode);
}
```

## Шаг 3: Специальный случай — `app/api/alerts/prioritized/route.ts`

Этот файл имеет другой паттерн:
```typescript
if (!runtimeState.usingMockData && !runtimeState.databaseConfigured) {
```

Заменить на:
```typescript
if (!runtimeState.databaseConfigured) {
```

## Шаг 4: Удалить неиспользуемые mock-data файлы

```bash
# Проверить что файлы больше не импортируются
grep -rn "mock-data\|mock-boards" --include="*.ts" --include="*.tsx" app/ lib/ | grep -v "docs/"
```

Если `lib/mock-data.ts` и `lib/mock-boards.ts` больше не импортируются в runtime коде — удалить:

```bash
# Только если grep не вернул результатов из app/ или lib/:
rm lib/mock-data.ts lib/mock-boards.ts
```

**НЕ удалять:** `prisma/seed-demo.ts` (нужен для `npm run seed:demo`).

## Шаг 5: Проверить тесты

```bash
grep -rn "usingMockData\|getMockTasks\|getMockProjects" lib/__tests__/ --include="*.ts"
```

Тесты в `lib/__tests__/runtime-mode.unit.test.ts` — оставить, они тестируют runtime-mode логику (не API routes).

## Шаг 6: Запустить проверки и закоммитить

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10

git add -A
git commit -m "refactor: remove dead usingMockData branches from all API routes

- shouldServeMockData() always returns false since Phase 5
- Remove unreachable if(runtime.usingMockData) blocks from 25+ routes
- Remove unused mock-data.ts and mock-boards.ts imports
- Remaining usingMockData references are in tests/docs (intentional)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Результат на выходе

- [ ] `grep -rn "usingMockData" app/api/ --include="*.ts"` возвращает пустой результат
- [ ] Build проходит без ошибок
- [ ] Все vitest тесты зелёные
- [ ] `lib/mock-data.ts` удалён (если не используется в runtime)

---

---

# PROMPT C — Tool-streaming UX + Валидация

## Задача

Backend уже отправляет события `toolCall` и `meta` в SSE-стриме.  
Но `hooks/use-ai-chat.ts` их игнорирует.  
Нужно:
1. Обработать `toolCall` / `meta` в хуке
2. Отразить tool execution в chat UI
3. Добавить server-side валидацию параметров инструментов

## Контекст

`app/api/ai/chat/route.ts` уже отправляет (строки 289-298):
```typescript
if (toolCall) {
  controller.enqueue(encoder.encode(
    `data: ${JSON.stringify({
      type: 'toolCall',
      payload: { name: toolCall.name, params: toolCall.params, result: toolResult },
    })}\n\n`
  ));
}
// + meta event
controller.enqueue(encoder.encode(
  `data: ${JSON.stringify({
    type: 'meta',
    success: orchestratorResult.result.success,
    duration: orchestratorResult.duration,
    provider: provider || 'default',
  })}\n\n`
));
```

## Шаг 1: Расширить интерфейс `Message` в `hooks/use-ai-chat.ts`

```typescript
// БЫЛО:
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  agent?: { id: string; name: string };
  duration?: number;
}

// СТАЛО:
interface ToolCallPayload {
  name: string;
  params: Record<string, unknown>;
  result?: { success: boolean; data?: unknown; error?: string; message?: string };
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  agent?: { id: string; name: string };
  duration?: number;
  toolCall?: ToolCallPayload;  // НОВОЕ
  meta?: {                     // НОВОЕ
    success: boolean;
    duration?: number;
    provider?: string;
  };
}
```

Также добавить в `UseAIChatReturn`:
```typescript
interface UseAIChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}
```

(Интерфейс `UseAIChatReturn` не меняется, но экспортировать `ToolCallPayload` и `Message` типы.)

## Шаг 2: Обработать события `toolCall` и `meta` в хуке

В секции обработки SSE событий (строки 97-109) добавить:

```typescript
// БЫЛО:
if (evt.type === 'chunk' && evt.content) {
  // ...
} else if (evt.type === 'agent' && evt.agent) {
  // ...
} else if (evt.type === 'error') {
  throw new Error(evt.error);
}

// СТАЛО:
if (evt.type === 'chunk' && evt.content) {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === assistantId ? { ...m, content: m.content + evt.content } : m
    )
  );
} else if (evt.type === 'agent' && evt.agent) {
  setMessages((prev) =>
    prev.map((m) => (m.id === assistantId ? { ...m, agent: evt.agent } : m))
  );
} else if (evt.type === 'toolCall' && evt.payload) {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === assistantId ? { ...m, toolCall: evt.payload as ToolCallPayload } : m
    )
  );
} else if (evt.type === 'meta') {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === assistantId ? { ...m, meta: evt, duration: evt.duration } : m
    )
  );
} else if (evt.type === 'error') {
  throw new Error(evt.error);
}
```

## Шаг 3: Показать tool execution в chat UI

Найти компонент где рендерятся сообщения — скорее всего `components/chat/chat-message.tsx` или аналог:

```bash
find components/chat -name "*.tsx" | xargs grep -l "message\|content" 2>/dev/null
```

Добавить отображение `toolCall` в компонент сообщения:

```typescript
// Пример добавления в chat message компонент
{message.toolCall && (
  <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-800 dark:bg-blue-950">
    <div className="flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-300">
      <span>⚡ Tool: {message.toolCall.name}</span>
      {message.toolCall.result?.success ? (
        <span className="text-green-600">✓</span>
      ) : (
        <span className="text-red-600">✗</span>
      )}
    </div>
    {message.toolCall.result?.message && (
      <p className="mt-1 text-blue-600 dark:text-blue-400">
        {message.toolCall.result.message}
      </p>
    )}
  </div>
)}
```

## Шаг 4: Добавить server-side валидацию параметров инструментов

В файле `lib/ai/tools/index.ts` обновить функцию `executeTool`:

```typescript
// БЫЛО:
export async function executeTool(
  name: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { success: false, error: `Tool not found: ${name}` };
  }
  return tool.execute(params);
}

// СТАЛО:
const MAX_TOOL_RESULT_LENGTH = 2000;

export async function executeTool(
  name: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { success: false, error: `Tool not found: ${name}` };
  }

  // Validate required parameters
  const required = tool.parameters?.required ?? [];
  const missing = required.filter((key: string) => !(key in params));
  if (missing.length > 0) {
    return {
      success: false,
      error: `Missing required parameters: ${missing.join(', ')}`,
    };
  }

  try {
    const result = await tool.execute(params);

    // Cap result size to prevent context explosion
    if (result.data) {
      const serialized = JSON.stringify(result.data);
      if (serialized.length > MAX_TOOL_RESULT_LENGTH) {
        return {
          ...result,
          data: `[Result truncated — ${serialized.length} chars. Use a more specific query.]`,
        };
      }
    }

    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Tool execution failed',
    };
  }
}
```

## Шаг 5: Запустить проверки и закоммитить

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10

git add -A
git commit -m "feat: surface tool execution in chat UI + add param validation

- useAIChat now handles toolCall and meta SSE events
- Chat UI shows tool name, success/failure badge and result message
- executeTool validates required params before execution
- Tool results capped at 2000 chars to prevent context explosion

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Результат на выходе

- [ ] `hooks/use-ai-chat.ts` обрабатывает `toolCall`, `meta` события
- [ ] В chat UI видно какой инструмент вызвался и его результат
- [ ] `executeTool()` валидирует required params и caps result size
- [ ] Build + tsc + tests проходят

---

---

# PROMPT D — Перенос настроек в БД

## Задача

`contexts/preferences-context.tsx` хранит все настройки в `localStorage`.  
Это значит настройки теряются при смене устройства или после logout.  
Нужно добавить backend API и синхронизировать настройки с БД.

## Шаг 1: Добавить модель в Prisma schema

В файле `prisma/schema.prisma` после модели `User` (строка ~32) добавить:

```prisma
model UserPreferences {
  id                  String   @id @default(cuid())
  userId              String   @unique
  workspaceId         String   @default("delivery")
  compactMode         Boolean  @default(true)
  desktopNotifications Boolean @default(true)
  soundEffects        Boolean  @default(false)
  emailDigest         Boolean  @default(true)
  aiResponseLocale    String   @default("ru")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

Добавить relation в модель `User`:
```prisma
model User {
  // ... existing fields ...
  preferences UserPreferences?
}
```

## Шаг 2: Создать миграцию

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev
npx prisma db push
npx prisma generate
```

## Шаг 3: Создать API endpoint

Создать файл `app/api/settings/preferences/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { prisma } from "@/lib/prisma";

const defaultPreferences = {
  workspaceId: "delivery",
  compactMode: true,
  desktopNotifications: true,
  soundEffects: false,
  emailDigest: true,
  aiResponseLocale: "ru",
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(defaultPreferences); // Return defaults for unauthenticated
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { preferences: true },
    });

    if (!user?.preferences) {
      return NextResponse.json(defaultPreferences);
    }

    const { id, userId, createdAt, updatedAt, ...prefs } = user.preferences;
    return NextResponse.json(prefs);
  } catch {
    return NextResponse.json(defaultPreferences);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      workspaceId,
      compactMode,
      desktopNotifications,
      soundEffects,
      emailDigest,
      aiResponseLocale,
    } = body;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const prefs = await prisma.userPreferences.upsert({
      where: { userId: user.id },
      update: {
        ...(workspaceId !== undefined && { workspaceId }),
        ...(compactMode !== undefined && { compactMode: Boolean(compactMode) }),
        ...(desktopNotifications !== undefined && { desktopNotifications: Boolean(desktopNotifications) }),
        ...(soundEffects !== undefined && { soundEffects: Boolean(soundEffects) }),
        ...(emailDigest !== undefined && { emailDigest: Boolean(emailDigest) }),
        ...(aiResponseLocale !== undefined && { aiResponseLocale: String(aiResponseLocale) }),
      },
      create: {
        userId: user.id,
        workspaceId: workspaceId ?? "delivery",
        compactMode: compactMode !== undefined ? Boolean(compactMode) : true,
        desktopNotifications: desktopNotifications !== undefined ? Boolean(desktopNotifications) : true,
        soundEffects: soundEffects !== undefined ? Boolean(soundEffects) : false,
        emailDigest: emailDigest !== undefined ? Boolean(emailDigest) : true,
        aiResponseLocale: aiResponseLocale ?? "ru",
      },
    });

    const { id, userId: uid, createdAt, updatedAt, ...result } = prefs;
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 }
    );
  }
}
```

## Шаг 4: Обновить `contexts/preferences-context.tsx`

Добавить server sync в `PreferencesProvider`. Изменения минимальны:

1. Добавить `import { useSession } from "next-auth/react";` в начало (или использовать fetch без session).

2. В `useEffect` для загрузки (строка ~114) — после чтения из localStorage, сделать fallback fetch из API:

```typescript
useEffect(() => {
  const loadPreferences = async () => {
    try {
      const nextAccessProfile = readClientAccessProfile();
      const nextAvailableWorkspaces = getAvailableWorkspacesForRole(nextAccessProfile.role);
      const fallbackWorkspaceId = resolveAccessibleWorkspace(
        nextAccessProfile.role,
        nextAccessProfile.workspaceId
      ).id;

      // Try server first (authenticated users)
      let serverPrefs: Partial<AppPreferences> | null = null;
      try {
        const resp = await fetch("/api/settings/preferences");
        if (resp.ok) serverPrefs = await resp.json();
      } catch {
        // server unavailable — use localStorage
      }

      // Merge: server overrides localStorage
      const raw = serverPrefs ?? (() => {
        try {
          const s = localStorage.getItem(PREFERENCES_STORAGE_KEY);
          return s ? JSON.parse(s) : null;
        } catch { return null; }
      })();

      const nextPreferences = raw
        ? normalizePreferences(raw, nextAvailableWorkspaces, fallbackWorkspaceId)
        : { ...defaultPreferences, workspaceId: fallbackWorkspaceId };

      setAccessProfile(nextAccessProfile);
      setPreferences(nextPreferences);
      applyDensity(nextPreferences.compactMode);
    } catch {
      applyDensity(defaultPreferences.compactMode);
    } finally {
      setIsReady(true);
    }
  };

  loadPreferences();
}, []);
```

3. В `useEffect` для сохранения (строка ~136) — добавить sync с сервером:

```typescript
useEffect(() => {
  applyDensity(preferences.compactMode);
  if (!isReady) return;

  // Save to localStorage (immediate)
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch { /* ignore */ }

  // Sync to server (debounced, fire-and-forget)
  const timer = setTimeout(() => {
    fetch("/api/settings/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    }).catch(() => { /* silent fail — localStorage remains as fallback */ });
  }, 500);

  return () => clearTimeout(timer);
}, [isReady, preferences]);
```

## Шаг 5: Запустить проверки и закоммитить

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10

git add -A
git commit -m "feat: persist user preferences to database

- Add UserPreferences Prisma model with migration
- Add GET/PUT /api/settings/preferences endpoint
- PreferencesProvider loads from server on mount
- Changes saved to localStorage immediately + synced to server (debounced 500ms)
- localStorage remains as fallback when server unavailable

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Результат на выходе

- [ ] `prisma/schema.prisma` содержит модель `UserPreferences`
- [ ] `app/api/settings/preferences/route.ts` существует и отвечает на GET/PUT
- [ ] `contexts/preferences-context.tsx` синхронизирует с сервером
- [ ] Настройки сохраняются после logout/login
- [ ] Build + tsc + tests проходят

---

---

# PROMPT E — Gantt/Calendar — Завершение

## Задача

1. `/gantt` страница (`components/gantt/gantt-page.tsx`) берёт данные из dashboard context — нужно переключить на API.
2. Dependency lines не рендерятся (API `/api/gantt/dependencies` отдаёт данные, но frontend их игнорирует).
3. `/api/calendar/events` содержит мёртвую `if (runtime.usingMockData)` ветку — удалить.
4. Calendar добавить пустое состояние и detail view при клике.

## Шаг 1: Переключить `/gantt` на API

В `components/gantt/gantt-page.tsx` добавить SWR вызов и использовать API данные вместо dashboard context:

```typescript
// Добавить в imports:
import useSWR from "swr";

// Типы для API данных:
interface GanttApiItem {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies: string[];
  type?: string;
  projectId?: string;
}

// Добавить fetcher:
const fetcher = (url: string) => fetch(url).then(r => r.json());

// Добавить в компонент:
export function GanttPage() {
  const { enumLabel, formatDateLocalized, t } = useLocale();
  const { projects } = useDashboard(); // Оставить для projectFilter options
  const [scale, setScale] = useState<Scale>("week");
  const [projectFilter, setProjectFilter] = useState<"all" | string>("all");

  // NEW: Load Gantt data from API
  const apiUrl = projectFilter === "all"
    ? null // No single-project Gantt for "all" — use dashboard data
    : `/api/projects/${projectFilter}/gantt`;

  const { data: apiGanttTasks, isLoading: apiLoading } = useSWR<GanttApiItem[]>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false }
  );

  // For "all projects" view: build items from dashboard context as before
  // For single project: use API response
  const items = useMemo(() => {
    if (projectFilter !== "all" && apiGanttTasks) {
      return apiGanttTasks.map(task => ({
        id: task.id,
        kind: "task" as const,
        label: task.name,
        start: task.start,
        end: task.end,
        status: task.type === "done" ? "completed" as const
               : task.type === "blocked" ? "at-risk" as const
               : "active" as const,
        meta: `${Math.round(task.progress ?? 0)}%`,
      }));
    }

    // All projects: dashboard context
    const relevantProjects =
      projectFilter === "all"
        ? projects
        : projects.filter((project) => project.id === projectFilter);

    return relevantProjects.flatMap((project) => [
      {
        id: project.id,
        kind: "project" as const,
        label: project.name,
        start: project.dates.start,
        end: project.dates.end,
        status: project.status,
        meta: `${project.progress}%`,
      },
    ]);
  }, [projectFilter, apiGanttTasks, projects]);
```

## Шаг 2: Загрузить и отобразить зависимости

В `components/gantt/gantt-page.tsx` добавить зависимости как визуальные аннотации:

```typescript
// Добавить тип:
interface GanttDependency {
  id: string;
  source: string;
  target: string;
  sourceTask: string;
  targetTask: string;
}

// Добавить SWR:
const { data: dependencies = [] } = useSWR<GanttDependency[]>(
  "/api/gantt/dependencies",
  fetcher,
  { revalidateOnFocus: false }
);

// Отобразить как список под диаграммой, если есть:
{dependencies.length > 0 && (
  <Card className="mt-4">
    <CardHeader>
      <CardTitle className="text-sm">{t("gantt.dependencies") ?? "Зависимости"}</CardTitle>
    </CardHeader>
    <CardContent>
      <ul className="space-y-1 text-xs text-[var(--ink-soft)]">
        {dependencies.map(dep => (
          <li key={dep.id}>
            <span className="font-medium">{dep.targetTask}</span>
            {" → "}
            <span>{dep.sourceTask}</span>
          </li>
        ))}
      </ul>
    </CardContent>
  </Card>
)}
```

## Шаг 3: Убрать dead mock ветвь из `/api/calendar/events`

В файле `app/api/calendar/events/route.ts`:

```typescript
// УДАЛИТЬ:
if (runtime.usingMockData) {
  const { getMockTasks, getMockProjects } = await import("@/lib/mock-data");
  // ... весь этот блок ...
}

// ОСТАВИТЬ:
if (!runtime.databaseConfigured) {
  return databaseUnavailable(runtime.dataMode);
}
```

## Шаг 4: Добавить пустое состояние в Calendar

Найти calendar компонент (скорее всего `components/calendar/calendar-view.tsx`):

```bash
find components/calendar -name "*.tsx"
```

Добавить состояние для нулевых событий:

```typescript
// После загрузки данных:
if (!isLoading && events.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
      <p className="text-sm">Нет событий в этом периоде</p>
      <p className="text-xs mt-1">Задачи с дедлайнами появятся здесь автоматически</p>
    </div>
  );
}
```

## Шаг 5: Запустить проверки и закоммитить

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10

git add -A
git commit -m "feat: Gantt API-backed view + dependency list + calendar cleanup

- /gantt single-project view uses /api/projects/[id]/gantt API
- Dependency list rendered below Gantt from /api/gantt/dependencies
- Remove dead usingMockData branch from /api/calendar/events
- Add empty state for calendar view

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Результат на выходе

- [ ] `/gantt` в режиме single-project загружает данные из API
- [ ] Зависимости видны под Gantt диаграммой
- [ ] Calendar API не содержит mock branches
- [ ] Calendar пустое состояние корректно
- [ ] Build + tsc + tests проходят

---

---

# PROMPT F — Deploy Hardening + Runbook

## Задача

1. Прекратить притворяться, что текущая Prisma migration chain уже безопасна для Postgres deploy.
2. Перевести `vercel-build` на guarded production-prepare flow.
3. Синхронизировать `prisma/schema.postgres.prisma` с основным `schema.prisma` (если расходятся).
4. Создать/обновить operational runbook `RUNBOOK.md`.
5. Финальный env audit.

## Шаг 1: Синхронизировать postgres schema

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev

# Проверить расхождение
diff <(grep "^model \|^enum " prisma/schema.prisma | sort) \
     <(grep "^model \|^enum " prisma/schema.postgres.prisma | sort)
```

Если есть расхождения — скопировать основной schema и заменить только datasource:

```bash
# Обновить schema.postgres.prisma
cp prisma/schema.prisma prisma/schema.postgres.prisma
```

Затем в `prisma/schema.postgres.prisma` найти и заменить datasource block:

```prisma
// БЫЛО:
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// СТАЛО:
datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_PRISMA_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}
```

## Шаг 2: Перевести vercel-build на guarded migrate flow

В файле `package.json` найти строку `vercel-build`:

```json
// БЫЛО:
"vercel-build": "cp prisma/schema.postgres.prisma prisma/schema.prisma && prisma generate && npx prisma db push --skip-generate && npm run seed:auth && npm run seed:production && next build"

// СТАЛО:
"prisma:prepare:production": "bash ./scripts/prepare-production-prisma.sh",
"vercel-build": "npm run prisma:prepare:production && npm run seed:production && next build"
```

Создать `scripts/prepare-production-prisma.sh`:

```bash
#!/bin/bash
set -euo pipefail

cp prisma/schema.postgres.prisma prisma/schema.prisma
npx prisma generate

if [ "${CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY:-false}" = "true" ]; then
  npx prisma migrate deploy
else
  echo "Skipping prisma migrate deploy until Postgres baseline is rebuilt."
fi
```

**Важно:** schema-changing deploy нельзя считать закрытым, пока не создан новый Postgres baseline migration. До этого момента:

- app-only deploy разрешен
- schema-changing packet заморожен
- флаг `CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY=true` использовать только после baseline reset

После baseline reset:
```bash
# Переключиться на postgres schema
npm run db:postgres

# Создать новый baseline migration на Postgres
# затем отметить существующую prod-базу как baseline-applied
# через prisma migrate resolve

# Вернуться на sqlite для dev
npm run db:sqlite
```

## Шаг 3: Финальный env audit

Проверить `.env.production.example` содержит все обязательные переменные:

```bash
cat .env.production.example
```

Обязательные переменные для production:

```env
# Required
DATABASE_URL=postgresql://...
POSTGRES_PRISMA_URL=postgresql://...
POSTGRES_URL_NON_POOLING=postgresql://...
NEXTAUTH_SECRET=<random-32-bytes>
NEXTAUTH_URL=https://your-app.vercel.app
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# AI (at least one)
OPENROUTER_API_KEY=sk-or-v1-...

# Optional but recommended
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
TELEGRAM_BOT_TOKEN=...
LOG_LEVEL=info
```

Добавить в `.env.production.example` блок с обязательными переменными если их нет.

## Шаг 4: Создать `RUNBOOK.md`

Создать файл `/Users/aleksandrgrebeshok/ceoclaw-dev/RUNBOOK.md`:

```markdown
# CEOClaw — Operations Runbook

## Deploy (Vercel)

### First deploy
1. Create Neon PostgreSQL project at https://neon.tech
2. Copy DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING
3. Set all env vars from .env.production.example in Vercel Dashboard
4. Generate NEXTAUTH_SECRET: `openssl rand -base64 32`
5. Push to main branch → auto-deploy triggers
6. Verify: GET https://your-app.vercel.app/api/health

### Re-deploy / Update
- Push to main → Vercel auto-deploys
- vercel-build runs: schema copy → migrate deploy → seeds → next build
- Seeds are idempotent (safe to run multiple times)

### Rollback
- Vercel Dashboard → Deployments → select previous → Redeploy
- Database is NOT automatically rolled back — use Neon point-in-time restore if needed

---

## Health Check

```bash
# Check app health
curl https://your-app.vercel.app/api/health
# Expected: {"status":"healthy","database":"connected"}

# Check AI providers
curl https://your-app.vercel.app/api/ai/chat -X GET
```

---

## Database

### Backup (Neon)
- Neon auto-creates backups every 24h
- Manual snapshot: Neon Dashboard → Branches → Create branch

### Migrations
```bash
# Local dev
npx prisma migrate dev --name "feature-name"

# Production (automatic via vercel-build)
npx prisma migrate deploy

# Emergency: check migration status
npx prisma migrate status
```

---

## Monitoring (Sentry)

- Dashboard: https://sentry.io/organizations/ceoclaw/
- Configure alerts: Settings → Alerts → New Alert Rule
- Recommended: alert on >10 errors/hour

---

## AI Providers

Order of priority: GigaChat → YandexGPT → AIJora → Polza → OpenRouter → ...

If streaming stops working:
1. Check OPENROUTER_API_KEY is valid
2. Check /api/health for provider status
3. Fallback models: gemma-3-27b → 12b → 4b

---

## Seed Data

```bash
# Auth users (idempotent)
npm run seed:auth

# Production kanban board (idempotent)
npm run seed:production

# Demo data (DEV ONLY — destructive!)
npm run seed:demo  # ⚠️ deletes all projects/tasks first
```

---

## Environment Variables Reference

See `.env.production.example` for full list with descriptions.

Critical variables that MUST be set:
- `DATABASE_URL` — PostgreSQL connection
- `NEXTAUTH_SECRET` — Auth encryption key
- `NEXTAUTH_URL` — App URL (must match Vercel URL)
- At least one AI provider key
```

## Шаг 5: Запустить проверки и закоммитить

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10

git add -A
git commit -m "deploy: switch to migrate deploy + create operations runbook

- vercel-build uses prisma migrate deploy instead of db push
- Sync schema.postgres.prisma with main schema
- Add RUNBOOK.md with deploy, rollback, monitoring, seed instructions
- Finalize .env.production.example with all required variables

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Результат на выходе

- [ ] `vercel-build` использует `prisma migrate deploy`
- [ ] `prisma/schema.postgres.prisma` синхронизирован с основным schema
- [ ] `RUNBOOK.md` создан с полными операционными инструкциями
- [ ] `.env.production.example` содержит все обязательные переменные
- [ ] Build + tsc + tests проходят
- [ ] Приложение готово к деплою на Vercel

---

---

## Порядок выполнения

```
Prompt A → Prompt B → Prompt C → Prompt D → Prompt E → Prompt F
```

Каждый промпт:
1. Читается агентом целиком
2. Выполняется шаг за шагом
3. Все проверки (tsc, build, tests) должны быть зелёными
4. Делается один коммит в конце
5. Передаётся ревьюеру для проверки

**Нельзя пропускать:** Prompt A и Prompt B — это foundation. Без них Prompt C-F будут работать на загрязнённой кодовой базе.

---

## Что НЕ входит в эти промпты (для следующей фазы)

- Tauri desktop app
- Advanced Gantt (drag-to-reschedule, SVG dependency arrows)
- Calendar event creation/editing
- Email digest sending
- Advanced Sentry (performance tracing, session replay)
