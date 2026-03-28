# CEOClaw — Полный аудит проекта и план дальнейшей работы

> **Дата:** 2026-03-26  
> **Коммит:** 8d1a0fd (ветка `feature/map-first-ui`)  
> **Автор аудита:** Copilot (Claude Opus 4.6)

---

## Содержание

1. [Метрики проекта](#1-метрики-проекта)
2. [Архитектура — общая оценка](#2-архитектура--общая-оценка)
3. [Backend & Data Layer](#3-backend--data-layer)
   - 3.1 [Prisma Schema](#31-prisma-schema)
   - 3.2 [API Routes](#32-api-routes)
   - 3.3 [Обработка ошибок](#33-обработка-ошибок)
   - 3.4 [Аутентификация и безопасность](#34-аутентификация-и-безопасность)
   - 3.5 [Daemon](#35-daemon)
   - 3.6 [CI/CD](#36-cicd)
4. [Frontend](#4-frontend)
   - 4.1 [Компоненты](#41-компоненты)
   - 4.2 [State Management](#42-state-management)
   - 4.3 [Кастомные хуки](#43-кастомные-хуки)
   - 4.4 [Стилизация](#44-стилизация)
   - 4.5 [Производительность](#45-производительность)
   - 4.6 [Accessibility](#46-accessibility)
   - 4.7 [Кроссплатформенность](#47-кроссплатформенность)
   - 4.8 [Type Safety](#48-type-safety)
5. [План vs Реальность](#5-план-vs-реальность)
   - 5.1 [AI-PMO Северавтодор → CEOClaw](#51-ai-pmo-северавтодор--ceoclaw)
   - 5.2 [Волны разработки](#52-волны-разработки)
   - 5.3 [Team Roadmap vs факт](#53-team-roadmap-vs-факт)
   - 5.4 [Features Checklist](#54-features-checklist)
6. [Сводная таблица оценок](#6-сводная-таблица-оценок)
7. [Приоритизированный план улучшений](#7-приоритизированный-план-улучшений)
   - 7.1 [Критические — неделя 1](#71-критические--неделя-1)
   - 7.2 [Высокие — спринт 1-2](#72-высокие--спринт-1-2)
   - 7.3 [Средние — спринт 3-4](#73-средние--спринт-3-4)
   - 7.4 [Долгосрочные](#74-долгосрочные)
8. [Конкретные рефакторинги с примерами кода](#8-конкретные-рефакторинги-с-примерами-кода)

---

## 1. Метрики проекта

| Метрика | Значение |
|---------|----------|
| Файлов TS/TSX | **1 013** |
| Строк кода | **167 022** |
| Компонентов React | **245** |
| API-маршрутов | **179** |
| Моделей Prisma | **54** (индексов: 152, связей: 61) |
| Коммитов | **218** |
| Тестов (Vitest) | **132/132 ✅** |
| Уязвимостей prod | **0** |
| Размер `.next` | **2.2 GB** ⚠️ |
| `node_modules` | **1.1 GB** |
| Контекстов React | **5** |
| Кастомных хуков | **3** |
| Error boundaries | **8 из ~40 маршрутов** |
| Loading states | **13 loading.tsx** |
| Dynamic imports | **20** |
| `React.memo` | **14** |
| `useMemo` | **212** |
| `useCallback` | **58** |
| `next/image` | **0** ⚠️ |

---

## 2. Архитектура — общая оценка

### Итоговый рейтинг: **8/10**

CEOClaw — технически зрелый продукт с 93% реализованных фич (144/155), чистой типизацией, и продуманной доменной структурой. Основные слабые места — производительность бандла, отсутствие коммерческого слоя, и незавершённая security-hardening.

### Ключевые архитектурные решения:

**5 основных «позвоночников» продукта:**

1. **Portfolio & Execution** — Dashboard, проекты, задачи, Gantt, календарь, риски, аналитика
2. **Work-Report Control Chain** — Draft → Submit → Review → Approve → Signal Packet → Telegram/Email → Delivery Ledger
3. **Evidence & Reconciliation Truth** — Персистентный ledger, анализ, casefiles, cross-source operational context
4. **AI Runtime** — Route-aware provider shell, AI runs, chat/context flows, replayable execution traces
5. **Policy & Access Layer** — Role/workspace policy, API guards + UI gating

### Что делает архитектуру сильной:

- **Чёткое разделение:** `app/api` → `lib/service` → `prisma/models`. Каждый домен изолирован.
- **Policy-слой:** Единая модель прав (`PlatformPermission`) работает и в API, и в UI.
- **Connector-паттерн:** GPS, 1C, Telegram, Email — каждый через адаптер с `DerivedSyncStore`.
- **TypeScript strict: true** по всему проекту.
- **Prisma type inference** из схемы — минимальный boilerplate.

---

## 3. Backend & Data Layer

### 3.1 Prisma Schema

**Файл:** `prisma/schema.prisma` — 1 161 строка, 54 модели

**Конфигурация:**
- PostgreSQL (pooled `DATABASE_URL` + direct `DIRECT_URL` для миграций)
- Committed migrations: 4 миграции в `prisma/migrations/`
- Separate seed scripts: auth, demo, production, preview

**Группы моделей:**

| Группа | Модели | Назначение |
|--------|--------|------------|
| Auth | User, Account, Session, Membership, Organization, Workspace, WorkspaceMembership | Мультитенантность |
| Core | Project, Task, Milestone, Document, TeamMember, Risk | Управление проектами |
| Operations | Expense, Equipment, ResourceAssignment, Supplier, Contract | Операции |
| AI | AiRunLedger, AiApplyDecisionLedger, AgentSession, AIProvider | AI-подсистема |
| Delivery | DeliveryLedger, Communication, EscalationItem, EvidenceRecord | Доставка и контроль |
| Integration | ConnectorCredential, ConnectorSyncEntry, DerivedSyncState | Коннекторы |

**Индексирование:**
- Композитные индексы: `(workspaceId, status)`, `(createdAt)`, `(status, updatedAt)`, `(projectId, date)`
- Unique constraints на OAuth провайдеры, credentials, workspace membership
- Каскадное удаление: Projects → Tasks, Documents, Expenses; Workspaces → Memberships

**✅ Что хорошо:**
- Postgres-first дизайн
- Аудит-поля `createdAt`/`updatedAt` на всех моделях
- JSON metadata поля для гибких структур
- 152 индекса — хорошее покрытие

**⚠️ Что улучшить:**
- Мягкая денормализация (`projectName` в `EscalationItem`) может рассинхрониться
- Нет partial indexes для частых WHERE-условий
- Нет `pg_trgm`/FTS для полнотекстового поиска
- N+1 защита — полностью на уровне приложения

**Конкретные рекомендации:**
```sql
-- Partial index для частых запросов по активным задачам
@@index([status], map: "idx_task_active")
-- (в Prisma: реализуется через raw SQL миграцию)
-- CREATE INDEX idx_tasks_active ON "Task" (id) WHERE status = 'IN_PROGRESS';

-- Trigram поиск (требует расширение PostgreSQL)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX idx_project_name_trgm ON "Project" USING gin (name gin_trgm_ops);
```

---

### 3.2 API Routes

**179 route.ts файлов** в `app/api/`

**Архитектурные паттерны (применяемые единообразно):**

```typescript
// 1. Единая авторизация
const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
if (authResult instanceof NextResponse) return authResult;

// 2. Условные includes для оптимизации payload
select: {
  id: true, name: true,
  ...(includeTasks ? { tasks: { select: { id: true, title: true } } } : {}),
}

// 3. Пагинация с count
const [items, total] = await Promise.all([
  prisma.task.findMany({ skip, take: limit, where }),
  prisma.task.count({ where }),
]);

// 4. Транзакции (используются в 9 маршрутах)
await prisma.$transaction(async (tx) => {
  await tx.task.update({ ... });
  await tx.project.update({ ... });
});
```

**Группировка маршрутов:**

| Категория | Примеры | ~Кол-во |
|-----------|---------|---------|
| Projects & Tasks | `/projects/`, `/tasks/[id]/`, `/tasks/dependencies/` | ~15 |
| AI & Agents | `/ai/chat/`, `/ai/runs/[id]/`, `/agents/execute/` | ~8 |
| Интеграции | `/connectors/oauth/`, `/calendar/sync/`, `/telegram/webhook/` | ~40 |
| Финансы | `/expenses/`, `/billing/checkout/`, `/finance/export/` | ~15 |
| Планирование | `/scheduling/auto-schedule/`, `/scheduling/resource-leveling/` | ~6 |
| Отчётность | `/reports/executive-pack/`, `/analytics/overview/` | ~10 |
| Администрирование | `/admin/migrate-*`, `/admin/seed/` | ~10 |
| Auth | `/auth/[...nextauth]/`, `/auth/register/` | ~5 |
| Health | `/health/` | 1 |

**⚠️ Проблемы API-слоя:**

| Проблема | Влияние | Рекомендация |
|----------|---------|--------------|
| Нет rate limiting на бизнес-маршрутах | DDoS-уязвимость | lru-cache: 100 req/min authenticated, 20 public |
| Нет API versioning | Breaking changes ломают клиентов | `/api/v1/` prefix |
| Нет OpenAPI/Swagger | Нет автодокументации | `next-swagger-doc` или `zod-to-openapi` |
| Нет таймаутов | AI-запросы/экспорты могут зависнуть | AbortController + timeout wrapper |
| Нет circuit breaker | GPS/1C failure каскадирует | `opossum` или custom implementation |

---

### 3.3 Обработка ошибок

**Централизовано в `lib/server/api-utils.ts`:**

| Функция | HTTP-код | Назначение |
|---------|----------|------------|
| `badRequest(message)` | 400 | Невалидный запрос |
| `validationError(zodError)` | 400 | Zod-ошибки с details |
| `forbidden(message)` | 403 | Нет доступа |
| `notFound(message)` | 404 | Не найдено |
| `serverError(error, fallback)` | 500 | Серверная ошибка |
| `serviceUnavailable(message)` | 503 | Сервис недоступен |
| `databaseUnavailable()` | 503 | БД недоступна |

**Формат ответа:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": { "fieldErrors": { "email": "Required" } }
  }
}
```

**Prisma-specific detection:**
- `isPrismaNotFoundError(error)` — P2025
- `isDatabaseConnectionError(error)`
- `isPrismaSchemaMissingError(error)`

**В production `serverError()` отдаёт generic message** — stack traces не утекают.

**⚠️ Что улучшить:**
- `console.error` → structured logging (Pino/Winston)
- Нет correlation ID → невозможно трассировать запрос через систему
- Sentry — optional, не mandatory → может быть выключен

**Рекомендация — добавить request ID:**
```typescript
// middleware.ts или api-utils.ts
export function withRequestId(handler: NextHandler): NextHandler {
  return async (req: NextRequest) => {
    const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
    const response = await handler(req);
    response.headers.set("x-request-id", requestId);
    return response;
  };
}
```

---

### 3.4 Аутентификация и безопасность

**NextAuth v4 — JWT-сессии:**

| Компонент | Реализация |
|-----------|------------|
| Провайдеры | Credentials (email/pass), Google OAuth, GitHub OAuth |
| Хеширование | bcryptjs (10 rounds) |
| Rate limit | 5 попыток / 15 мин на auth |
| JWT claims | `{ id, role, organizationSlug, workspaceId }` |
| Workspace isolation | Все запросы фильтруются по `workspaceId` |
| Роли | `EXEC`, `MANAGER`, `USER`, `VIEWER` |
| Permissions | `MANAGE_TASKS`, `MANAGE_PROJECTS`, `MANAGE_USERS`, `RUN_AI_ACTIONS`, etc. |

**Middleware:** защищает все маршруты кроме whitelist (login, signup, landing, API).  
**API keys:** для cron/webhook через `DASHBOARD_API_KEY` (Bearer token).

**⚠️ Критические пробелы безопасности:**

| Проблема | Severity | Рекомендация |
|----------|----------|--------------|
| Нет CSRF-токенов | 🔴 High | `csrf` пакет + double-submit cookie |
| Нет Content Security Policy | 🔴 High | CSP headers в `next.config.mjs` |
| Rate limiting только на auth | 🟠 Medium | Расширить на все POST/PATCH/DELETE |
| Нет SAML/SSO | 🟡 Low (пока) | Блокер для enterprise в будущем |
| Нет audit log export | 🟡 Low | Для SOC 2 compliance |

**Рекомендация — CSP headers:**
```javascript
// next.config.mjs
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://openrouter.ai https://*.sentry.io",
      "font-src 'self'",
    ].join('; ')
  }
];
```

---

### 3.5 Daemon

**Путь:** `daemon/` — фоновый сервис на Node.js

**Архитектура:**
```
Startup:
  1. Load config (ceoclaw.json + hot-reload)
  2. Connect Prisma → PostgreSQL
  3. Register health checks (db, cron, telegram)
  4. Start Cron (croner library)
  5. Start Telegram Bot (grammY, polling mode)
  6. Start HTTP Gateway → порт 18790
  7. Graceful shutdown (SIGTERM/SIGINT)
```

**Подсистемы:**

| Подсистема | Назначение | Health Check |
|------------|------------|--------------|
| Database | Prisma connection | Connectivity probe |
| Cron | Scheduled tasks | Running + job count |
| Telegram | Bot polling | Active? |
| Gateway | `/health`, `/status`, `/v1/chat/completions` | HTTP alive? |

**Управление:**
```bash
npx tsx daemon/index.ts           # Запуск
npx tsx daemon/index.ts install   # macOS LaunchAgent
npx tsx daemon/index.ts status    # Статус
npx tsx daemon/index.ts uninstall # Удаление
```

---

### 3.6 CI/CD

**GitHub Actions (`ci.yml`):**

| Job | Что делает |
|-----|------------|
| lint | ESLint + `tsc --noEmit` |
| test | Vitest + coverage → Codecov |
| build | `next build` |
| e2e | Playwright smoke (условный) |
| deploy | Vercel (push в main) |

**Vercel cron jobs:**

| Расписание | Маршрут | Назначение |
|------------|---------|------------|
| 4:30 UTC пн-пт | `/api/retention/telegram-morning-brief/run-due` | Утренний брифинг |
| 6:00 UTC пн | `/api/retention/email-digest/run-due` | Email-дайджест |
| 5:00 UTC ежедневно | `/api/connectors/one-c/expenses/run-due` | Синхронизация 1С |

**Vercel security headers (уже настроены):**
```json
{ "X-Content-Type-Options": "nosniff" },
{ "X-Frame-Options": "DENY" },
{ "X-XSS-Protection": "1; mode=block" }
```

---

## 4. Frontend

### 4.1 Компоненты

**250 файлов, ~45K строк, 100% функциональные (0 классов)**

**UI-примитивы (22 штуки, shadcn/ui + Radix):**  
Card, Button, Input, Dialog, Tabs, Badge, Progress, Tooltip, Select, Popover, Dropdown, Checkbox, Switch, Separator, Sheet, ScrollArea, Avatar, Calendar, Command, Table, Label, Textarea

Все используют `React.forwardRef`:
```typescript
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-lg border...", className)} {...props} />
));
Card.displayName = "Card";
```

**Props typing — строгий:**
```typescript
interface ProjectCardProps {
  project: Project;
  taskCount: number;
  onEdit?: (project: Project) => void;
  onDuplicate?: (projectId: string) => void;
}
```

**Мемоизация:**

| Паттерн | Кол-во | Где используется |
|---------|--------|------------------|
| `React.memo` | 14 | ProjectCard, KanbanCard, KanbanColumn, AgentSelector, ChatLayout |
| `useMemo` | 212 | Translations, filtered lists, computed values, context values |
| `useCallback` | 58 | Event handlers, fetch functions, context callbacks |

**⚠️ Файлы, требующие разбиения:**

| Файл | Строки | Проблема |
|------|--------|----------|
| `project-detail.tsx` | 1 563 | Смешаны edit, export, display, tabs |
| `portfolio-cockpit.tsx` | 1 198 | Dashboard агрегация |
| `work-report-action-pilot.tsx` | 1 027 | Сложная форма |
| `gantt-page.tsx` | 1 017 | Gantt + интеракции |
| `wizard.tsx` (onboarding) | 1 000 | Многошаговый wizard |
| `dashboard-provider.tsx` | 872 | Provider с бизнес-логикой |
| `field-operations-page.tsx` | 752 | Карта + операции |
| `goals-page.tsx` | 764 | OKR management |
| `ai-context.tsx` | 761 | Chat + agents + proposals |

---

### 4.2 State Management

**5 контекстов (Context API, без Redux/Zustand):**

| Контекст | Строки | Оценка | Ключевые паттерны |
|----------|--------|--------|-------------------|
| `ai-context.tsx` | 761 | 8/10 | State machine, 10+ useCallback, agent routing, proposals |
| `preferences-context.tsx` | 320 | 9/10 | API sync + localStorage fallback, migration, AbortController |
| `locale-context.tsx` | ~200 | 9/10 | RU/EN/ZH, date-fns locales, `t()`, `enumLabel()` |
| `theme-context.tsx` | ~150 | 9/10 | `matchMedia`, localStorage, useMemo |
| `memory-context.tsx` | ~80 | 8/10 | Clean delegation к memoryManager |

**Продвинутые паттерны в `preferences-context`:**
- API → localStorage fallback (graceful degradation)
- Миграция localStorage → API при первом подключении
- AbortController для cleanup при unmount
- Skip-first-persist (useRef) — предотвращает дублирование
- `normalizePreferences()` для type safety

**⚠️ `ai-context.tsx` (761 строк) — рекомендуется split:**
```
contexts/
├── ai-chat-context.tsx        — сессии, сообщения, streaming
├── ai-agent-context.tsx       — routing, quick actions, agent selection
└── ai-proposal-context.tsx    — proposal/apply workflow, decisions
```

---

### 4.3 Кастомные хуки

**`use-persistent-state.ts`** — ✅ Эталонный:
- Cross-tab синхронизация (StorageEvent + CustomEvent)
- SSR-safe (`typeof window` check)
- Generic TypeScript: `usePersistentState<T>(key, initial): [T, SetValue<T>, () => void]`
- Updater functions: `setState(prev => ...)`
- `removeValue` callback

**`use-ai-chat.ts`** — ✅ Хорошо спроектирован:
- Message state с метаданными (duration, provider, model, runId)
- Tool call tracking
- Нормализация AI confidence/evidence
- useCallback с proper dependency tracking

**`use-desktop-hotkeys.ts`** — ✅ Чисто:
- Desktop keyboard shortcuts
- Cleanup на unmount

---

### 4.4 Стилизация

**Stack: Tailwind CSS 3.4 + CSS Variables + CVA (Class Variance Authority)**

**Design tokens — 30+ CSS переменных:**
```css
/* Light */
--surface: #f3f4f6;        --surface-panel: #ffffff;
--ink: #0f172a;             --brand: #3b82f6;
--line: rgba(15,23,42,0.08);

/* Dark (.dark) */
--surface: #0f0f10;         --surface-panel: #1f1f1f;
--ink: #f5f5f5;
```

**Density system:**
```css
html[data-density="compact"] {
  --spacing-xs: 0.375rem;
  --shell-sidebar-padding: 0.75rem;
}
```

**Z-index иерархия:**
```
dropdown: 20 → sticky: 30 → modal: 40 → toast: 50 → tooltip: 60
```

**CVA для вариантов:**
```typescript
const buttonVariants = cva("inline-flex items-center justify-center...", {
  variants: {
    variant: { default: "bg-[var(--brand)]...", secondary: "...", danger: "..." },
    size: { default: "h-10 px-4", sm: "h-8 px-3", lg: "h-11 px-5", icon: "h-10 w-10" },
  },
});
```

**Оценка: 9/10** — нет хардкода цветов, полная dark mode поддержка, CJK шрифты, accessible focus states.

---

### 4.5 Производительность

**Code Splitting:**
```typescript
// Recharts грузится лениво
const BudgetChart = dynamic(
  () => import("@/components/analytics/budget-chart"),
  { ssr: false, loading: () => <LoadingPlaceholder /> }
);

// Export on-demand
const { downloadProjectPdf } = await import("@/lib/export");
```

**ClientChart wrapper для SSR-safe рендеринга:**
```typescript
export function ClientChart({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? children : <ChartSkeleton />;
}
```

**Текущее состояние:**

| Метрика | Значение | Цель |
|---------|----------|------|
| Dynamic imports | 20 | 50+ |
| `next/image` | 0 | Все изображения |
| `React.memo` | 14 | 30+ (таблицы, списки) |
| Loading states | 13 | Все маршруты |
| Error boundaries | 8 | Все маршруты |
| Bundle (.next) | 2.2 GB | < 800 MB |
| Web Vitals мониторинг | ❌ | ✅ web-vitals + Sentry |

**Топ-оптимизации по ROI:**

1. **`next/image`** — замена всех `<img>` даст -30-40% трафика изображений
2. **Lazy Recharts** — уже частично, но 4.5MB chunks всё ещё загружаются eagerly в некоторых местах
3. **Dynamic imports** — добавить для: map, gantt, field-operations, equipment, onboarding wizard
4. **prefers-reduced-motion** — отключение анимаций для accessibility

---

### 4.6 Accessibility

**~85-90% WCAG 2.1 AA:**

| Критерий | Уровень | Статус | Реализация |
|----------|---------|--------|------------|
| 1.1.1 Non-text Content | A | ✅ | `role="img" aria-label` на графиках |
| 2.4.6 Headings/Labels | AA | ✅ | Правильная иерархия h1-h3 |
| 4.1.2 Name, Role, Value | A | ✅ | `role="progressbar" aria-valuenow` |
| 4.1.3 Status Messages | AA | ✅ | `aria-live="polite"` для загрузки |
| 3.2.4 Consistent ID | AA | ✅ | Verified |
| 1.4.3 Contrast | AA | ⚠️ | Нужен color contrast audit |
| 2.1.1 Keyboard | A | ⚠️ | Частично — modals/dropdowns |

**Паттерны:**
```tsx
// Графики
<div role="img" aria-label={t("accessibility.charts.trendDescription")}>
  <Chart aria-hidden="true" />
</div>

// Live regions для загрузки
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {isLoading ? "Загрузка данных..." : `Загружено: ${count} элементов`}
</div>

// Progress bars
<div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
  <Progress value={progress} />
</div>
```

---

### 4.7 Кроссплатформенность

**PWA + Capacitor (iOS/Android) + Tauri (Desktop)**

| Платформа | Статус | Детали |
|-----------|--------|--------|
| **Web (Vercel)** | ✅ Deployed | https://ceoclaw.vercel.app |
| **PWA** | ✅ Ready | manifest.json, service worker, install prompt |
| **iOS (Capacitor)** | ⚠️ Shell | `com.ceoclaw.mobile`, Universal Links, нет App Store |
| **Android** | ⚠️ Ready | Capacitor — тот же код, нет Google Play |
| **macOS (Tauri)** | ⚠️ DMG | Local AI gateway, нет auto-update |

**Tauri — 3 Rust файла:**
- `main.rs` — entry point
- `lib.rs` — main library
- `local_gateway.rs` (16KB) — offline AI gateway

---

### 4.8 Type Safety

**Frontend (components, contexts, hooks): 9.5/10 ✅**
- `strict: true` в tsconfig
- **0 использований `any`** в components/, contexts/, hooks/
- Все props через explicit interface
- Generic types с inference
- Union types: `"light" | "dark" | "system"`

**Backend (lib/): ~8/10**
- ~4 файла с `any` (в основном AI provider parsers)
- Рекомендация — заменить на Zod-схемы:

```typescript
// Вместо: const data: any = await response.json();
import { z } from "zod";
const AIResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() })
  })),
});
const data = AIResponseSchema.parse(await response.json());
```

---

## 5. План vs Реальность

### 5.1 AI-PMO Северавтодор → CEOClaw

**Эволюция:**
```
Январь 2026:  AI-PMO Северавтодор — 86 документов КСУП (все написаны ✅)
     ↓
Февраль 2026: Pivot → CEOClaw — универсальная PM-платформа с AI
     ↓
Март 2026:    218 коммитов, 11 волн, 167K строк кода
     ↓
Сейчас:       Рабочий продукт, 93% фич, 0 коммерческих клиентов
```

**Из оригинального плана AI-PMO:**

| Что планировалось | Что реализовано | Статус |
|-------------------|-----------------|--------|
| 86 документов КСУП | 86/86 написаны | ✅ 100% |
| 5 AI-агентов PMO | 21+ агент в multi-agent runtime | ✅ Превышено |
| GPS/GLONASS трекинг | Коннектор работает (read-only) | ✅ 90% |
| 1C-интеграция | OData коннектор (расходы, финансы) | ✅ 85% |
| Telegram-боты | grammY бот + delivery chain | ✅ 95% |
| Video Fact (CV) | Фреймворк спроектирован, код — нет | ❌ 10% |
| Деплой в Северавтодор | Не было | ❌ 0% |
| Соответствие ГОСТ/ISO | Документы есть, код не валидирован | ⚠️ 40% |
| Строительная специфика | Generic PM вместо отраслевого | ⚠️ 30% |

---

### 5.2 Волны разработки

| Волна | Сессии | Что добавлено |
|-------|--------|---------------|
| 0 | — | Stabilization baseline |
| 1 | S01-02 | Import, action engine, briefs |
| 2 | S03-04 | Work reports, connectors |
| 3 | S05-08 | Org/workspace/policy, plan-vs-fact |
| 4 | S09-14 | Vertical pilots (meeting→action, report→action) |
| 5 | S15-20 | GPS, 1C, email delivery, truth layers |
| 6 | S21-26 | Evidence, cross-source confidence |
| 7 | S27-29 | AI run persistence, delivery ledger, idempotent execution |
| 8 | S30-32 | GPS expansion, 1C deepening, reconciliation casefiles |
| 9 | S33-35 | Command center, audit packs, pilot controls |
| 10 | S36-38 | Pilot feedback, readiness checklist, governance export |
| **11** | **S39-42** | **Governance automation, cutover, onboarding, rollout** |
| 12 | TBD | Определяется реальными bottlenecks |

---

### 5.3 Team Roadmap vs факт

| Неделя | План | Результат |
|--------|------|-----------|
| 1–2 | Approval model + Role UI | ✅ Wave 11 |
| 3–4 | Role dashboards | ✅ Wave 11 |
| 5–6 | Telegram/1C/GPS коннекторы | ✅ Waves 5–8 |
| 7–8 | Security + Docker | ⚠️ 0 vulns, нет Docker |
| Июнь | Коммерческий запуск | ❌ Не начат |
| Июнь | 5–10 платящих клиентов | ❌ 0 клиентов |
| Июнь | MRR $175–350 | ❌ $0 |

---

### 5.4 Features Checklist

**144/155 фич реализовано (93%)**

Не реализовано (11 фич):
- Stripe billing (UI-мок, backend отсутствует)
- Granular RBAC (базовый есть, advanced — нет)
- Kubernetes manifests
- Self-hosted Docker
- Video Fact computer vision
- SSO/SAML
- Predictive analytics (ML)
- Data residency controls
- SOC 2 compliance
- Audit log export
- App Store / Google Play publication

---

## 6. Сводная таблица оценок

| Измерение | Оценка | Детали |
|-----------|--------|--------|
| **Prisma Schema** | 8.5/10 | 54 модели, 152 индекса. Нет FTS, partial indexes |
| **API Routes** | 8/10 | 179 маршрутов, единая auth. Нет rate limit, versioning |
| **Error Handling** | 8/10 | Centralized, typed. Нет structured logging |
| **Auth & Security** | 7/10 | JWT, RBAC, workspace isolation. Нет CSRF, CSP |
| **Daemon** | 8.5/10 | Модульный, health checks, graceful shutdown |
| **CI/CD** | 8/10 | Lint + test + build. E2E не обязательный gate |
| **Компоненты** | 9/10 | 100% functional, строгие типы, React.memo |
| **State Management** | 8.5/10 | Context API, API sync, migration patterns |
| **Стилизация** | 9/10 | Tailwind + CSS vars + CVA + dark mode |
| **Производительность** | 7/10 | Code splitting ✅, 0 next/image, 2.2GB bundle |
| **Accessibility** | 8.5/10 | ~90% WCAG AA, ARIA, live regions |
| **Type Safety** | 9.5/10 | 0 any на фронтенде, strict mode |
| **Кроссплатформенность** | 7.5/10 | PWA + Capacitor + Tauri |
| **Документация** | 9/10 | 86 КСУП + 13 планов + RUNBOOK |
| **Бизнес-готовность** | 4/10 | 0 клиентов, 0 revenue |
| **ИТОГО** | **≈ 8/10** | Технически зрелый, бизнес незрелый |

---

## 7. Приоритизированный план улучшений

### 7.1 Критические — неделя 1

#### 7.1.1 Postgres bootstrap validation
**Статус:** Единственный блокер production-ready.  
**Действие:**
```bash
# 1. Запустить одноразовый Postgres
docker run --rm -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16

# 2. Прогнать миграции
DATABASE_URL=postgresql://postgres:test@localhost:5433/ceoclaw \
DIRECT_URL=postgresql://postgres:test@localhost:5433/ceoclaw \
npx prisma migrate deploy

# 3. Проверить seed
npx tsx prisma/seed-production.ts

# 4. Убить контейнер — он одноразовый
```

#### 7.1.2 CSRF protection
**Файлы:** `middleware.ts` + API routes  
**Решение:** Double-submit cookie pattern или `csrf` npm package.

#### 7.1.3 Content Security Policy
**Файл:** `next.config.mjs`  
**Решение:** Добавить CSP headers (см. секцию 3.4).

---

### 7.2 Высокие — спринт 1-2

#### 7.2.1 API rate limiting
**Где:** Все бизнес-маршруты POST/PATCH/DELETE  
**Как:** `lru-cache` (уже в зависимостях) → wrapper для API handlers

```typescript
// lib/server/rate-limit.ts
import { LRUCache } from "lru-cache";

const rateLimit = new LRUCache<string, number[]>({
  max: 5000,
  ttl: 60 * 1000, // 1 минута
});

export function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const timestamps = rateLimit.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < 60_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  rateLimit.set(key, recent);
  return true;
}
```

#### 7.2.2 `next/image` migration
**Масштаб:** Найти все `<img` тэги и заменить на `Image` из `next/image`  
**Приоритет:** Landing page, dashboard, project cards

#### 7.2.3 Разбиение файлов-гигантов
**Приоритет:**
1. `project-detail.tsx` (1563 → 8 файлов по ~200 строк)
2. `providers.ts` (890 → 4 файла: openrouter, zai, openai, base)
3. `translations.ts` (2719 → `locales/{ru,en,zh}.json`)
4. `ai-context.tsx` (761 → 3 контекста)

#### 7.2.4 Error boundaries на все маршруты
**Нужно добавить `error.tsx` в:**
gantt, calendar, finance, goals, equipment, map, contracts, search, signup, demo, chat, field-operations, materials, suppliers, expenses, command-center, meetings, resources, pilot-controls, pilot-feedback, pilot-review, tenant-onboarding, tenant-readiness, tenant-rollout-packet

#### 7.2.5 Structured logging
**Заменить** `console.error` → Pino с JSON output  
**Добавить** correlation ID (x-request-id) в middleware

#### 7.2.6 Bundle optimization → цель < 800MB
**Шаги:**
1. Включить `ANALYZE=true npm run build` для детального анализа
2. Проверить tree-shaking для lucide-react, date-fns, recharts
3. Добавить ещё 30+ dynamic imports для heavy components
4. Рассмотреть замену recharts → lightweight (visx, chart.js)
5. Проверить `next.config.mjs` → `experimental.optimizePackageImports`

---

### 7.3 Средние — спринт 3-4

#### 7.3.1 E2E расширение (5 → 25+ сценариев)
**Новые тесты:**
- CRUD проектов (create, edit, delete, list)
- CRUD задач + dependencies
- Approval workflow (submit → review → approve)
- AI chat (send message, get response)
- Connector settings (add/edit/remove)
- Экспорт (PDF, Excel)
- Error pages (404, 500)
- Responsive (mobile viewport)
- Dark mode toggle
- Language switch

#### 7.3.2 OpenAPI/Swagger
**Подход:** `zod-to-openapi` → автогенерация из Zod-схем

#### 7.3.3 Web Vitals мониторинг
```typescript
// app/layout.tsx или instrumentation-client.ts
import { onCLS, onFID, onLCP, onFCP, onTTFB } from 'web-vitals';

function sendToAnalytics(metric: Metric) {
  // Sentry, Analytics, или custom endpoint
}

onCLS(sendToAnalytics);
onLCP(sendToAnalytics);
onFID(sendToAnalytics);
```

#### 7.3.4 Circuit breaker для коннекторов
**Для:** GPS, 1C, Telegram  
**Паттерн:** Отслеживать failures, после N ошибок → circuit open → fallback → retry после cooldown

#### 7.3.5 Dependabot PRs
**11 открытых PR:** Next.js 16.2.1, Prisma 7.5.0, и другие → review и merge

#### 7.3.6 Legacy test cleanup
**69 файлов** в `lib/__tests__/` исключены из Vitest → удалить или обновить

---

### 7.4 Долгосрочные

| # | Задача | Цель | Блокирует |
|---|--------|------|-----------|
| 1 | Docker compose | Self-hosted enterprise | Enterprise продажи |
| 2 | Stripe MVP | Free/Pro/Enterprise | Revenue |
| 3 | SSO/SAML | Enterprise auth | Enterprise клиенты |
| 4 | Full-text search (pg_trgm) | Глобальный поиск | UX |
| 5 | prefers-reduced-motion | Accessibility | WCAG AA |
| 6 | Lighthouse > 90 | Performance certification | Marketing |
| 7 | Video Fact pipeline | Computer vision verification | Строительная специфика |
| 8 | Kubernetes manifests | Масштабирование | High-load клиенты |
| 9 | Predictive analytics | ML forecasting | AI differentiator |
| 10 | App Store / Google Play | Mobile distribution | Mobile users |
| 11 | Auto-update (Tauri) | Desktop UX | Desktop users |

---

## 8. Конкретные рефакторинги с примерами кода

### 8.1 Rate Limiter для API

```typescript
// lib/server/rate-limit.ts
import { LRUCache } from "lru-cache";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const DEFAULT: RateLimitConfig = { maxRequests: 100, windowMs: 60_000 };

const cache = new LRUCache<string, number[]>({ max: 10_000, ttl: 300_000 });

export function rateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const timestamps = cache.get(key) ?? [];
  const windowStart = now - config.windowMs;
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: recent[0] + config.windowMs - now,
    };
  }

  recent.push(now);
  cache.set(key, recent);

  return {
    allowed: true,
    remaining: config.maxRequests - recent.length,
    resetMs: config.windowMs,
  };
}
```

**Использование в маршруте:**
```typescript
// app/api/projects/route.ts
import { rateLimit } from "@/lib/server/rate-limit";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`api:projects:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
    );
  }
  // ... rest of handler
}
```

---

### 8.2 project-detail.tsx → разбиение

**До:** 1 файл, 1 563 строки

**После:**
```
components/projects/
├── project-detail.tsx              (~200 строк — orchestrator)
├── project-detail-header.tsx       (~150 строк — title, status, actions)
├── project-detail-tabs.tsx         (~100 строк — tab navigation)
├── project-detail-overview.tsx     (~200 строк — основная информация)
├── project-detail-timeline.tsx     (~200 строк — Gantt/milestones)
├── project-detail-team.tsx         (~150 строк — команда проекта)
├── project-detail-finance.tsx      (~200 строк — бюджет, расходы)
├── project-detail-risks.tsx        (~150 строк — риски)
└── project-detail-export.tsx       (~100 строк — PDF/Excel export)
```

**Orchestrator:**
```typescript
// components/projects/project-detail.tsx
"use client";

import { ProjectDetailHeader } from "./project-detail-header";
import { ProjectDetailTabs } from "./project-detail-tabs";
import { ProjectDetailOverview } from "./project-detail-overview";
// ... etc

export function ProjectDetail({ project }: { project: Project }) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="space-y-6">
      <ProjectDetailHeader project={project} />
      <ProjectDetailTabs active={activeTab} onChange={setActiveTab} />
      {activeTab === "overview" && <ProjectDetailOverview project={project} />}
      {activeTab === "timeline" && <ProjectDetailTimeline project={project} />}
      {activeTab === "team" && <ProjectDetailTeam project={project} />}
      {activeTab === "finance" && <ProjectDetailFinance project={project} />}
      {activeTab === "risks" && <ProjectDetailRisks project={project} />}
    </div>
  );
}
```

---

### 8.3 providers.ts → split

**До:** 1 файл, 890 строк

**После:**
```
lib/ai/providers/
├── index.ts              (~50 строк — re-exports + factory)
├── base.ts               (~100 строк — interface + shared utils)
├── openrouter.ts          (~250 строк)
├── zai.ts                 (~200 строк)
├── openai.ts              (~200 строк)
└── dns-cache.ts           (~80 строк — IPv4 DNS cache)
```

---

### 8.4 Error boundary template

```typescript
// app/[route]/error.tsx (шаблон для всех маршрутов)
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Route Error]", error);
    // Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
      <AlertTriangle className="h-12 w-12 text-[var(--warn)]" />
      <h2 className="text-xl font-semibold">Что-то пошло не так</h2>
      <p className="text-sm text-[var(--ink-soft)]">
        {error.message || "Произошла непредвиденная ошибка"}
      </p>
      <Button onClick={reset} variant="secondary">
        Попробовать снова
      </Button>
    </div>
  );
}
```

---

### 8.5 Request ID middleware

```typescript
// lib/server/request-id.ts
import { NextRequest, NextResponse } from "next/server";

export function withRequestId(response: NextResponse, request: NextRequest): NextResponse {
  const requestId =
    request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("x-request-id", requestId);
  return response;
}
```

---

> **Этот документ является живым справочником.** Обновляйте его по мере реализации пунктов плана.  
> Следующий аудит рекомендуется провести после завершения спринта 2 (пункты 7.1 + 7.2).
