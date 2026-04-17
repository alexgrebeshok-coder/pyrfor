# CEOClaw — План доведения продукта до уровня 9/10

**Текущий уровень:** 7.4/10
**Целевой уровень:** 9.0/10
**Дата создания:** 21 марта 2026

---

## Стратегия

Для подъёма с 7.4 до 9.0 нужно набрать **+1.6 балла** по взвешенной шкале.
Основной рост придёт из трёх самых слабых областей:

| Область | Текущая | Целевая | Дельта | Вес | Вклад |
|---------|---------|---------|--------|-----|-------|
| Безопасность | 6.0 → | 9.0 | +3.0 | 15% | **+0.45** |
| DevOps/CI-CD | 5.5 → | 9.0 | +3.5 | 10% | **+0.35** |
| Тестирование | 7.0 → | 9.0 | +2.0 | 10% | **+0.20** |
| Архитектура | 8.0 → | 9.0 | +1.0 | 15% | **+0.15** |
| AI-интеграция | 8.5 → | 9.5 | +1.0 | 15% | **+0.15** |
| Документация | 7.0 → | 9.0 | +2.0 | 5% | **+0.10** |
| Код (TS+React) | 8.25 → | 9.0 | +0.75 | 20% | **+0.15** |
| Производительность | 8.0 → | 9.0 | +1.0 | 5% | **+0.05** |
| **Итого** | | | | | **+1.60** |

**Новая оценка: 7.43 + 1.60 = 9.03/10** ✅

---

## Фаза 0 — Критическая безопасность (НЕМЕДЛЕННО)

> **Цель:** Закрыть критические уязвимости, которые делают production-деплой рискованным
> **Безопасность: 6.0 → 7.5**

### 0.1 Удаление секретов из Git

**Проблема:** `.env.production` и `.env.vercel` отслеживаются в git и содержат реальные credentials.

**Шаги:**
```bash
# 1. Удалить файлы из git (сохранить локально)
git rm --cached .env.production .env.vercel

# 2. Добавить в .gitignore
echo ".env.production" >> .gitignore
echo ".env.vercel" >> .gitignore

# 3. Закоммитить
git add .gitignore
git commit -m "security: remove production secrets from git tracking"

# 4. Очистить историю (BFG Repo-Cleaner)
# Опционально, но рекомендуется:
bfg --delete-files .env.production
bfg --delete-files .env.vercel
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

**Ротация ключей (ОБЯЗАТЕЛЬНО):**
- [ ] Создать новый пароль базы данных Neon PostgreSQL
- [ ] Сгенерировать новый `NEXTAUTH_SECRET`
- [ ] Заменить OpenRouter API key
- [ ] Заменить ZAI API key
- [ ] Заменить Yandex Maps API key
- [ ] Обновить все ключи в Vercel Dashboard
- [ ] Обновить все ключи в локальном .env.local

### 0.2 Убрать 571 console.log

**Проблема:** 571 console.log в production-коде — утечка информации и шум в логах.

**Шаги:**
```bash
# 1. Массовая замена console.log на structured logger
# Использовать существующий logger (уже частично внедрён по коммиту 98e0b93)

# 2. Добавить ESLint правило
# В .eslintrc.json:
"no-console": ["error", { "allow": ["warn", "error"] }]

# 3. Автоматический fix
npx eslint --fix --rule '{"no-console": ["error", {"allow": ["warn", "error"]}]}' .
```

**Результат:** Структурированные логи вместо console.log, ESLint блокирует новые console.log.

### 0.3 Исправить несовместимость зависимостей

```bash
# Исправить react-is@^19 → ^18
npm install react-is@^18.2.0

# Проверить совместимость
npm ls react-is
```

---

## Фаза 1 — API Security Layer

> **Цель:** Защитить все 120+ API маршрутов аутентификацией
> **Безопасность: 7.5 → 8.5**

### 1.1 Создать универсальный auth wrapper

**Файл:** `lib/api/with-auth.ts`

```typescript
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";

type AuthenticatedHandler = (
  req: NextRequest,
  context: { session: Session; params?: Record<string, string> }
) => Promise<NextResponse>;

export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest, routeContext?: { params: Record<string, string> }) => {
    // Dev bypass
    if (process.env.CEOCLAW_SKIP_AUTH === "true" && process.env.NODE_ENV === "development") {
      const mockSession = { user: { id: "dev", role: "admin" } };
      return handler(req, { session: mockSession as Session, params: routeContext?.params });
    }

    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return handler(req, { session, params: routeContext?.params });
  };
}

// Wrapper для API Key auth (cron jobs, webhooks)
export function withApiKey(handler: AuthenticatedHandler) {
  return async (req: NextRequest, routeContext?: { params: Record<string, string> }) => {
    const authHeader = req.headers.get("authorization");
    const apiKey = authHeader?.replace("Bearer ", "");

    if (apiKey !== process.env.DASHBOARD_API_KEY) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const systemSession = { user: { id: "system", role: "system" } };
    return handler(req, { session: systemSession as Session, params: routeContext?.params });
  };
}
```

### 1.2 Применить wrapper ко всем API routes

Поэтапная миграция (по группам):

**Группа 1 — Критические (данные пользователей):**
- [ ] `/api/projects/*` (3 routes)
- [ ] `/api/tasks/*` (8 routes)
- [ ] `/api/team/*` (3 routes)
- [ ] `/api/risks/*` (2 routes)
- [ ] `/api/settings` (1 route)

**Группа 2 — Важные (бизнес-логика):**
- [ ] `/api/work-reports/*` (6 routes)
- [ ] `/api/analytics/*` (5 routes)
- [ ] `/api/briefs/*` (3 routes)
- [ ] `/api/documents/*` (2 routes)
- [ ] `/api/boards/*` (2 routes)
- [ ] `/api/milestones/*` (2 routes)
- [ ] `/api/calendar/*` (1 route)

**Группа 3 — AI & Memory:**
- [ ] `/api/ai/*` (11 routes) — уже частично защищены
- [ ] `/api/chat` (1 route) — уже защищён
- [ ] `/api/memory/*` (7 routes)
- [ ] `/api/agents/*` (3 routes)

**Группа 4 — Интеграции (API Key auth):**
- [ ] `/api/connectors/*` (12 routes)
- [ ] `/api/telegram/*` (2 routes)
- [ ] `/api/connectors/gps/*` (2 routes)
- [ ] `/api/connectors/one-c/*` (2 routes)

**Группа 5 — Административные:**
- [ ] `/api/admin/*` (6 routes) — RBAC: только admin
- [ ] `/api/escalations/*` (3 routes)
- [ ] `/api/audit-packs/*` (2 routes)
- [ ] `/api/command-center/*` (2 routes)

**Группа 6 — Tenant & Pilot:**
- [ ] `/api/tenant-*/*` (4 routes)
- [ ] `/api/pilot-*/*` (6 routes)

**Пример миграции одного route:**

```typescript
// БЫЛО:
export async function GET(req: NextRequest) {
  const projects = await prisma.project.findMany();
  return NextResponse.json(projects);
}

// СТАЛО:
import { withAuth } from "@/lib/api/with-auth";

export const GET = withAuth(async (req, { session }) => {
  const projects = await prisma.project.findMany({
    where: { workspaceId: session.user.workspaceId }
  });
  return NextResponse.json(projects);
});
```

### 1.3 Rate Limiting

**Файл:** `lib/api/rate-limit.ts`

```typescript
import { LRUCache } from "lru-cache";

const rateLimitMap = new LRUCache<string, number[]>({
  max: 500,
  ttl: 60_000, // 1 minute window
});

export function rateLimit(identifier: string, limit: number = 60): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(identifier) ?? [];
  const windowStart = now - 60_000;

  const filtered = timestamps.filter(t => t > windowStart);
  filtered.push(now);
  rateLimitMap.set(identifier, filtered);

  return filtered.length <= limit;
}
```

Применение:
- AI endpoints: **10 req/min** (LLM calls дорогие)
- CRUD endpoints: **60 req/min**
- Auth endpoints: **5 req/min** (brute force protection)
- Admin endpoints: **10 req/min**

### 1.4 Security Headers

Обновить `vercel.json`:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "0" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(self)" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.neon.tech https://*.openrouter.ai https://api.z.ai wss:; font-src 'self' data:"
        }
      ]
    }
  ]
}
```

### 1.5 Input Validation на API endpoints

Использовать Zod для валидации входных данных на каждом endpoint:

```typescript
import { z } from "zod";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(["planning", "active", "on-hold", "completed"]),
  budget: z.number().min(0).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const POST = withAuth(async (req, { session }) => {
  const body = await req.json();
  const parsed = CreateProjectSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const project = await prisma.project.create({ data: parsed.data });
  return NextResponse.json(project, { status: 201 });
});
```

---

## Фаза 2 — CI/CD Pipeline

> **Цель:** Автоматизировать тестирование, линтинг и деплой
> **DevOps: 5.5 → 9.0**

### 2.1 GitHub Actions: CI

**Файл:** `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, codex/*]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npx next lint
      - run: npx tsc --noEmit

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run test:run -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npx prisma db push
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  build:
    name: Production Build
    runs-on: ubuntu-latest
    needs: [unit-tests, e2e-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run build
```

### 2.2 GitHub Actions: Deploy

**Файл:** `.github/workflows/deploy.yml`

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    name: Deploy to Vercel
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: --prod
```

### 2.3 PR Quality Gates

**Файл:** `.github/workflows/pr-checks.yml`

```yaml
name: PR Checks

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  code-quality:
    name: Code Quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate

      # Lint
      - run: npx next lint

      # Type check
      - run: npx tsc --noEmit

      # Unit tests with coverage
      - run: npm run test:run -- --coverage

      # Check coverage thresholds
      - name: Check coverage
        run: |
          node -e "
            const report = require('./coverage/coverage-summary.json');
            const { lines, functions, branches } = report.total;
            const fails = [];
            if (lines.pct < 70) fails.push('Lines: ' + lines.pct + '% < 70%');
            if (functions.pct < 70) fails.push('Functions: ' + functions.pct + '% < 70%');
            if (branches.pct < 60) fails.push('Branches: ' + branches.pct + '% < 60%');
            if (fails.length) { console.error('Coverage below threshold:\\n' + fails.join('\\n')); process.exit(1); }
            console.log('Coverage OK: lines=' + lines.pct + '%, functions=' + functions.pct + '%, branches=' + branches.pct + '%');
          "
```

### 2.4 Dependabot

**Файл:** `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
    reviewers:
      - alexgrebeshok-coder
    labels:
      - dependencies
    groups:
      production:
        dependency-type: production
      development:
        dependency-type: development
```

---

## Фаза 3 — Тестирование

> **Цель:** Поднять покрытие и добавить недостающие типы тестов
> **Тестирование: 7.0 → 9.0**

### 3.1 Coverage Thresholds

Обновить `vitest.config.ts`:

```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  thresholds: {
    lines: 70,
    functions: 70,
    branches: 60,
    statements: 70,
  },
  exclude: [
    // ... существующие исключения
  ],
},
```

### 3.2 Unit-тесты для критических модулей

**Приоритет 1 — AI Provider Adapter:**
```typescript
// __tests__/lib/ai/provider-adapter.test.ts
describe("ProviderAdapter", () => {
  it("should fallback to next provider on timeout", async () => { ... });
  it("should fallback on InsufficientFundsError", async () => { ... });
  it("should retry on 429 with 1s delay", async () => { ... });
  it("should fail after all providers exhausted", async () => { ... });
  it("should respect provider priority from env", async () => { ... });
  it("should cache DNS for 5 minutes", async () => { ... });
});
```

**Приоритет 2 — Auto-routing:**
```typescript
// __tests__/lib/ai/auto-routing.test.ts
describe("routeToAgentId", () => {
  it("should route @director mentions to pmo-director", () => { ... });
  it("should route risk keywords to risk-researcher", () => { ... });
  it("should route task keywords with active project to execution-planner", () => { ... });
  it("should default to portfolio-analyst", () => { ... });
});
```

**Приоритет 3 — Safety profiles:**
```typescript
// __tests__/lib/ai/safety.test.ts
describe("SafetyProfile", () => {
  it("should mark create_tasks as medium level", () => { ... });
  it("should mark update_tasks as high level", () => { ... });
  it("should require approval for all proposals", () => { ... });
});
```

**Приоритет 4 — API Routes:**
```typescript
// __tests__/api/projects.test.ts
describe("Projects API", () => {
  it("GET /api/projects should return 401 without auth", async () => { ... });
  it("GET /api/projects should return projects list", async () => { ... });
  it("POST /api/projects should validate input with Zod", async () => { ... });
  it("POST /api/projects should create project", async () => { ... });
  it("PATCH /api/projects/[id] should update project", async () => { ... });
  it("DELETE /api/projects/[id] should delete project", async () => { ... });
});
```

### 3.3 Accessibility Testing (axe-core)

Добавить в Playwright E2E:

```typescript
// e2e/accessibility/a11y.spec.ts
import AxeBuilder from "@axe-core/playwright";

const pages = ["/", "/projects", "/tasks", "/kanban", "/chat", "/analytics"];

for (const page of pages) {
  test(`${page} should have no a11y violations`, async ({ page: p }) => {
    await p.goto(page);
    const results = await new AxeBuilder({ page: p })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```

### 3.4 API Contract Tests

```typescript
// __tests__/api/contracts.test.ts
import { z } from "zod";

const ProjectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["planning", "active", "on-hold", "completed"]),
  progress: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
});

describe("API Contracts", () => {
  it("GET /api/projects should match schema", async () => {
    const response = await fetch("/api/projects");
    const data = await response.json();
    const result = z.array(ProjectResponseSchema).safeParse(data);
    expect(result.success).toBe(true);
  });
});
```

---

## Фаза 4 — Качество кода

> **Цель:** Устранить code smells и улучшить maintainability
> **Код: 8.25 → 9.0**

### 4.1 Усилить ESLint

**Обновить `.eslintrc.json`:**

```json
{
  "extends": [
    "next/core-web-vitals",
    "next/typescript",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "react/jsx-key": "error",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "complexity": ["warn", 15],
    "max-lines": ["warn", { "max": 500, "skipBlankLines": true, "skipComments": true }],
    "import/order": ["warn", {
      "groups": ["builtin", "external", "internal", "parent", "sibling"],
      "newlines-between": "always",
      "alphabetize": { "order": "asc" }
    }]
  }
}
```

### 4.2 TypeScript config update

**Обновить `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"]
  }
}
```

### 4.3 Извлечение общих хуков

**`hooks/use-filtered.ts`** — заменит 3-4 дублированных реализации фильтрации:
```typescript
export function useFiltered<T>(
  items: T[],
  query: string,
  searchFields: (keyof T)[],
  filters?: Record<string, (item: T) => boolean>,
  sortFn?: (a: T, b: T) => number
): T[] {
  return useMemo(() => {
    let result = items;

    // Text search
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(item =>
        searchFields.some(field =>
          String(item[field]).toLowerCase().includes(q)
        )
      );
    }

    // Apply filters
    if (filters) {
      for (const filterFn of Object.values(filters)) {
        result = result.filter(filterFn);
      }
    }

    // Sort
    if (sortFn) result = [...result].sort(sortFn);

    return result;
  }, [items, query, searchFields, filters, sortFn]);
}
```

**`hooks/use-crud.ts`** — стандартный CRUD-хук:
```typescript
export function useCrud<T extends { id: string }>(endpoint: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => { ... }, [endpoint]);
  const create = useCallback(async (data: Partial<T>) => { ... }, [endpoint]);
  const update = useCallback(async (id: string, data: Partial<T>) => { ... }, [endpoint]);
  const remove = useCallback(async (id: string) => { ... }, [endpoint]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { items, loading, error, create, update, remove, refresh: fetchAll };
}
```

**`hooks/use-form-modal.ts`** — модалка с формой:
```typescript
export function useFormModal<T>() {
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<T | null>(null);

  const openCreate = useCallback(() => { setEditItem(null); setOpen(true); }, []);
  const openEdit = useCallback((item: T) => { setEditItem(item); setOpen(true); }, []);
  const close = useCallback(() => { setOpen(false); setEditItem(null); }, []);

  return { open, editItem, isEditing: !!editItem, openCreate, openEdit, close };
}
```

**Ожидаемый результат:** Сокращение дублирования кода на **~15-20%**.

### 4.4 Разбиение крупных файлов

| Файл | Строк | Действие |
|------|-------|----------|
| `prisma/seed-demo-projects.ts` | 5,211 | Разбить на seed файлы по доменам |
| `lib/translations.ts` | 2,656 | Вынести в отдельные JSON per locale |
| `components/portfolio/portfolio-cockpit.tsx` | 1,186 | Извлечь под-компоненты |
| `components/projects/project-detail.tsx` | 1,064 | Извлечь табы в отдельные компоненты |
| `lib/alerts/scoring.ts` | 1,045 | Разделить scoring rules и engine |

---

## Фаза 5 — Архитектурные улучшения

> **Цель:** Подготовить архитектуру к масштабированию
> **Архитектура: 8.0 → 9.0**

### 5.1 Repository Pattern

**Создать `lib/repositories/`:**

```typescript
// lib/repositories/base.ts
export abstract class BaseRepository<T, CreateDTO, UpdateDTO> {
  constructor(protected prisma: PrismaClient) {}

  abstract findAll(filters?: Record<string, unknown>): Promise<T[]>;
  abstract findById(id: string): Promise<T | null>;
  abstract create(data: CreateDTO): Promise<T>;
  abstract update(id: string, data: UpdateDTO): Promise<T>;
  abstract delete(id: string): Promise<void>;
}

// lib/repositories/project.ts
export class ProjectRepository extends BaseRepository<Project, CreateProjectDTO, UpdateProjectDTO> {
  async findAll(filters?: { status?: string; workspaceId?: string }): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: filters,
      orderBy: { updatedAt: "desc" },
      include: { tasks: { select: { id: true, status: true } } },
    });
  }

  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async create(data: CreateProjectDTO): Promise<Project> {
    return this.prisma.project.create({ data });
  }

  async update(id: string, data: UpdateProjectDTO): Promise<Project> {
    return this.prisma.project.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
```

**Repositories для создания:**
- [ ] `ProjectRepository`
- [ ] `TaskRepository`
- [ ] `TeamRepository`
- [ ] `RiskRepository`
- [ ] `DocumentRepository`
- [ ] `NotificationRepository`
- [ ] `AIRunRepository`
- [ ] `EvidenceRepository`

### 5.2 API Versioning

```
app/api/v1/projects/route.ts    ← Новые endpoints
app/api/projects/route.ts       ← Legacy (redirect to v1)
```

### 5.3 Feature Module Boundaries

Начать постепенную миграцию к feature boundaries:

```
lib/
├── features/
│   ├── projects/
│   │   ├── repository.ts     ← Data access
│   │   ├── service.ts        ← Business logic
│   │   ├── schemas.ts        ← Zod validation
│   │   └── types.ts          ← TypeScript types
│   ├── tasks/
│   │   ├── repository.ts
│   │   ├── service.ts
│   │   ├── schemas.ts
│   │   └── types.ts
│   └── ai/
│       ├── adapter.ts        ← Существующий
│       ├── provider-adapter.ts
│       ├── multi-agent-runtime.ts
│       └── safety.ts
```

> **Примечание:** Полная миграция к Feature-Sliced Design — долгосрочная задача. На этой фазе достаточно ввести boundaries в `lib/`.

---

## Фаза 6 — AI Resilience

> **Цель:** Повысить надёжность AI-подсистемы
> **AI: 8.5 → 9.5**

### 6.1 Circuit Breaker

**Файл:** `lib/ai/circuit-breaker.ts`

```typescript
type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly name: string,
    private readonly options: {
      failureThreshold: number;  // Failures before opening (default: 3)
      resetTimeout: number;       // ms before trying again (default: 60_000)
      halfOpenMax: number;        // Successes needed to close (default: 2)
    } = { failureThreshold: 3, resetTimeout: 60_000, halfOpenMax: 2 }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeout) {
        this.state = "half-open";
        this.successCount = 0;
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenMax) {
        this.state = "closed";
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = "open";
    }
  }

  getState(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}
```

Применение в provider-adapter.ts:
```typescript
private breakers = new Map<string, CircuitBreaker>();

private getBreaker(provider: string): CircuitBreaker {
  if (!this.breakers.has(provider)) {
    this.breakers.set(provider, new CircuitBreaker(provider, {
      failureThreshold: 3,
      resetTimeout: 60_000,
      halfOpenMax: 2,
    }));
  }
  return this.breakers.get(provider)!;
}

async tryProvider(name: string, input: AIRunInput): Promise<AIRunResult> {
  const breaker = this.getBreaker(name);
  return breaker.execute(() => this.callProvider(name, input));
}
```

### 6.2 Exponential Backoff

```typescript
// lib/ai/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 30_000, shouldRetry } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      if (shouldRetry && !shouldRetry(error)) throw error;

      const delay = Math.min(baseDelay * 2 ** attempt + Math.random() * 1000, maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error("Unreachable");
}
```

### 6.3 Configurable Timeouts

Перенести hardcoded значения в env:
```bash
# .env.example additions
AI_LOCAL_TIMEOUT_MS=10000
AI_CLOUD_TIMEOUT_MS=30000
AI_PROVIDER_PRIORITY="local-model,zai,openrouter"
AI_CIRCUIT_BREAKER_THRESHOLD=3
AI_CIRCUIT_BREAKER_RESET_MS=60000
AI_MAX_RETRIES=3
```

### 6.4 Provider Health Metrics

```typescript
// lib/ai/metrics.ts
interface ProviderMetrics {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastError?: string;
  lastSuccessAt?: Date;
  circuitState: CircuitState;
}

class AIMetricsCollector {
  private metrics = new Map<string, ProviderMetrics>();

  record(provider: string, latencyMs: number, success: boolean, error?: string): void {
    // Update metrics...
  }

  getMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.metrics);
  }

  // Expose via /api/ai/health endpoint
  toJSON(): Record<string, ProviderMetrics> {
    return Object.fromEntries(this.metrics);
  }
}
```

---

## Фаза 7 — Документация

> **Цель:** Покрыть пробелы в документации
> **Документация: 7.0 → 9.0**

### 7.1 API Documentation (OpenAPI)

Создать `docs/api/openapi.yaml` или использовать автогенерацию:

```bash
npm install swagger-jsdoc swagger-ui-react
```

Добавить JSDoc к каждому API route:
```typescript
/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: List all projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of projects
 *       401:
 *         description: Unauthorized
 */
```

### 7.2 Architecture Decision Records (ADR)

**Создать `docs/adr/`:**

| ADR | Тема |
|-----|------|
| `001-nextjs-app-router.md` | Почему Next.js 15 App Router |
| `002-ai-adapter-pattern.md` | Почему Adapter Pattern для AI |
| `003-multi-provider-fallback.md` | Стратегия fallback chain |
| `004-safety-first-ai.md` | Proposal/Approval workflow |
| `005-multi-platform.md` | Web + Tauri + Capacitor |
| `006-prisma-dual-db.md` | SQLite (dev) + PostgreSQL (prod) |
| `007-auth-strategy.md` | NextAuth + RBAC |

### 7.3 AI Subsystem Documentation

**Создать `docs/ai/README.md`:**
- Архитектура (диаграмма)
- Список агентов с описанием
- Fallback chain
- Safety profiles
- Добавление нового провайдера
- Добавление нового агента
- Конфигурация

### 7.4 Onboarding Guide

**Создать `docs/onboarding.md`:**
- Quick start (5 минут)
- Development environment setup
- Архитектурный обзор
- Ключевые паттерны
- Coding conventions
- PR process

---

## Фаза 8 — Производительность

> **Цель:** Оптимизировать узкие места
> **Производительность: 8.0 → 9.0**

### 8.1 Виртуализация списков

Для страниц с потенциально большим количеством элементов:

```bash
npm install @tanstack/react-virtual
```

```typescript
// Применить к: projects list, tasks list, notifications
import { useVirtualizer } from "@tanstack/react-virtual";

const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 72,
});
```

### 8.2 Lazy-loading переводов

Разбить `lib/translations.ts` (2656 строк) на отдельные файлы:

```
messages/
├── ru.json    ← уже есть (next-intl)
├── en.json
└── zh.json
```

Убедиться, что `lib/translations.ts` не загружает все языки одновременно.

### 8.3 Web Vitals мониторинг

```typescript
// app/layout.tsx или instrumentation.ts
import { onCLS, onFID, onLCP, onFCP, onTTFB } from "web-vitals";

function reportWebVitals(metric: Metric) {
  // Send to analytics
  if (process.env.NEXT_PUBLIC_ANALYTICS_ID) {
    fetch("/api/analytics/vitals", {
      method: "POST",
      body: JSON.stringify(metric),
    });
  }
}

onCLS(reportWebVitals);
onFID(reportWebVitals);
onLCP(reportWebVitals);
```

---

## Сводка: чеклист всех задач

### Фаза 0 — Критическая безопасность
- [ ] Удалить .env.production и .env.vercel из git
- [ ] Ротировать все скомпрометированные ключи
- [ ] Заменить 571 console.log на structured logger
- [ ] Добавить ESLint rule `no-console: error`
- [ ] Исправить react-is@^19 → ^18

### Фаза 1 — API Security Layer
- [ ] Создать `withAuth()` wrapper
- [ ] Применить auth ко всем API routes (6 групп, ~115 routes)
- [ ] Добавить rate limiting (LRU-based)
- [ ] Обновить security headers (HSTS, CSP, Referrer-Policy)
- [ ] Добавить Zod validation на все endpoints

### Фаза 2 — CI/CD Pipeline
- [ ] Создать `.github/workflows/ci.yml`
- [ ] Создать `.github/workflows/deploy.yml`
- [ ] Создать `.github/workflows/pr-checks.yml`
- [ ] Создать `.github/dependabot.yml`
- [ ] Настроить branch protection rules

### Фаза 3 — Тестирование
- [ ] Добавить coverage thresholds в vitest.config.ts
- [ ] Написать тесты AI Provider Adapter (fallback chain)
- [ ] Написать тесты Auto-routing
- [ ] Написать тесты Safety profiles
- [ ] Написать API contract тесты
- [ ] Добавить axe-core accessibility тесты в Playwright

### Фаза 4 — Качество кода
- [ ] Усилить ESLint конфигурацию
- [ ] Обновить TypeScript target → ES2022
- [ ] Создать `useFiltered()` хук
- [ ] Создать `useCrud()` хук
- [ ] Создать `useFormModal()` хук
- [ ] Разбить 5 крупнейших файлов на модули

### Фаза 5 — Архитектура
- [ ] Создать Repository Pattern (8 repositories)
- [ ] Ввести API versioning (v1)
- [ ] Создать feature module boundaries в lib/

### Фаза 6 — AI Resilience
- [ ] Реализовать Circuit Breaker
- [ ] Добавить Exponential Backoff
- [ ] Вынести тайм-ауты в env конфигурацию
- [ ] Добавить Provider Health Metrics
- [ ] Создать endpoint `/api/ai/health`

### Фаза 7 — Документация
- [ ] Создать OpenAPI/Swagger документацию
- [ ] Написать 7 ADR документов
- [ ] Документировать AI-подсистему
- [ ] Создать onboarding guide

### Фаза 8 — Производительность
- [ ] Добавить виртуализацию списков (@tanstack/react-virtual)
- [ ] Разбить translations на lazy-loaded chunks
- [ ] Добавить Web Vitals мониторинг

---

## Ожидаемый результат

После выполнения всех 8 фаз:

| Критерий | Было | Стало |
|----------|------|-------|
| Безопасность | 6.0 | **9.0** |
| DevOps/CI-CD | 5.5 | **9.0** |
| Тестирование | 7.0 | **9.0** |
| Архитектура | 8.0 | **9.0** |
| AI-интеграция | 8.5 | **9.5** |
| Код (TS+React) | 8.25 | **9.0** |
| Документация | 7.0 | **9.0** |
| Производительность | 8.0 | **9.0** |
| Доступность | 8.0 | **8.5** |
| **ИТОГО** | **7.4** | **~9.1** |

---

*План создан 21 марта 2026. Приоритет: Фаза 0 → Фаза 1 → Фаза 2 → остальные параллельно.*
