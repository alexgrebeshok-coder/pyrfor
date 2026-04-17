# CEOClaw — Architecture

**Updated:** `2026-04-17`
**Stack:** Next.js 15 · React 19 · TypeScript (strict) · Prisma 5 · PostgreSQL 16
**Deployment:** Vercel · GitHub Actions CI/CD

---

## System overview

CEOClaw is a full-stack enterprise PM / operations platform with seven architectural layers:

```text
+-------------------------------------------------------------------+
|                        CEOClaw Platform                           |
+-------------------------------------------------------------------+
|  UI Layer        69 pages · 255 components · i18n (ru/en/zh)      |
+-------------------------------------------------------------------+
|  API Layer       217 routes · auth middleware · rate limiting      |
+-------------------------------------------------------------------+
|  Domain Logic    438 modules across 50+ domain packages           |
+-------------------------------------------------------------------+
|  Orchestration   Agent runtime · workflows · DAG pipelines        |
+-------------------------------------------------------------------+
|  AI Kernel       Chat · model intelligence · cost tracking        |
+-------------------------------------------------------------------+
|  Data Layer      79 Prisma models · PostgreSQL · migrations       |
+-------------------------------------------------------------------+
|  Integrations    Telegram · Email · GPS · 1C · Yandex             |
+-------------------------------------------------------------------+
```

### Core operational spines

1. **Portfolio and execution** — dashboard, projects, tasks, gantt, kanban, calendar, goals/OKR, risks, analytics, field operations
2. **Work-report control chain** — drafting, review, approval, signal packet, export, delivery (Telegram/email)
3. **Evidence and reconciliation** — persisted ledger, operator inspection, analysis, reconciliation casefiles
4. **Agent orchestration** — agent registry, workflow builder, DAG pipelines, checkpoint replay, heartbeat monitoring
5. **AI runtime** — route-scoped AI provider, chat, model intelligence, adaptive timeout, cost budget tracking
6. **Enterprise operations** — finance, billing, contracts, suppliers, equipment, materials, command center
7. **Policy and access** — role/workspace permissions shared across API guards and UI gating

---

## Repository structure

```text
app/                        Next.js App Router
  api/                      217 API routes
    middleware/auth.ts       Central auth + rate limiting
  projects/                 Project management surfaces
  tasks/                    Task boards + kanban
  settings/agents/          Agent orchestration UI
  finance/                  Financial operations
  work-reports/             Report lifecycle
  [40+ more sections]       One directory per product surface

components/                 255 React components
  ui/                       Design system (shadcn/ui)
  dashboard/                Dashboard widgets
  orchestration/            Agent/workflow components
  projects/                 Project-specific components
  [45+ more packages]

lib/                        438 domain modules
  orchestration/            Agent runtime, pipelines, DAG
  ai/                       AI providers, model intelligence
  policy/                   Permission vocabulary
  server/                   Logger, API helpers
  agents/                   Agent definitions, skills
  [50+ more packages]

prisma/
  schema.prisma             79 models
  migrations/               PostgreSQL migration history

e2e/                        28 Playwright E2E specs
__tests__/                  67 Vitest unit test files (227 tests)
scripts/                    CI helpers, i18n validator, E2E runner
.github/workflows/ci.yml   5-job CI/CD pipeline
```

---

## Key architectural patterns

### API middleware chain

All authenticated API routes pass through `app/api/middleware/auth.ts`:

```text
Request -> Rate Limit (100 req/min/IP) -> Session Check -> Permission Guard -> Handler
```

This covers 177/217 routes. Remaining routes use alternative auth (demo, SSE, health).

### Agent orchestration

```text
Agent Registry -> Workflow Builder -> DAG Pipeline Engine
                                       +-- Stage dependencies
                                       +-- Acceptance criteria
                                       +-- Checkpoint replay
                                       +-- Heartbeat monitoring

Settings UI: /settings/agents/
  dashboard    — Agent metrics and status
  workflows    — Visual workflow builder
  runs/        — Execution history and replay
  heartbeat    — Agent health monitoring
  org-chart    — Agent hierarchy
  templates    — Workflow templates
```

### Work-report pipeline

```text
Draft -> Submit -> Review workspace -> Approval record
  -> Signal packet -> Markdown/JSON export
  -> Telegram + Email delivery -> Delivery ledger
```

### Error boundaries

Every major section has `error.tsx` + `loading.tsx` boundaries:
goals, finance, calendar, documents, chat, kanban, gantt, projects, tasks.

### Internationalization

909 translation keys across 3 locales (ru, en, zh) in `lib/translations.ts`.
Validated by `scripts/check-i18n.mjs` — all locales must be complete.

---

## Data layer

- **79 Prisma models** covering projects, tasks, agents, workflows, finance, evidence, approvals, and more
- **PostgreSQL 16** as the sole production database
- Migrations committed and CI-validated via `prisma migrate deploy`
- No SQLite — fully Postgres-first

---

## CI/CD pipeline

```text
GitHub Actions (5 jobs, sequential gates):

lint     -> npm audit (critical=block, high=warn) + ESLint + TypeScript
test     -> 67 Vitest files, 227 unit tests
build    -> Next.js production build
e2e      -> Tier 1 (4 specs, must-pass) + Tier 2 (9 specs, best-effort)
deploy   -> Vercel (main branch only)
```

E2E tier system (`scripts/ci-e2e.sh`):
- **Tier 1**: Proven-stable smoke specs (release, orchestration, error pages)
- **Tier 2**: Feature coverage (dashboard, projects, tasks, documents)
- **Tier 3**: Data-dependent and optional specs (manual/scheduled)

---

## Validation metrics

| Metric | Value |
|---|---|
| API routes | 217 |
| Pages | 69 |
| Prisma models | 79 |
| Components | 255 |
| Unit tests | 227 (67 files) |
| E2E specs | 28 (13 in CI) |
| TypeScript | strict: true, zero any in app/lib/components |
| i18n coverage | 909 keys x 3 locales = 100% |
| Rate limiting | 177/217 routes (81%) |
| Error boundaries | 9 sections covered |

---

## Security

- **Authentication**: NextAuth.js with session-based auth
- **Rate limiting**: LRU-based, 100 req/min per IP on all auth routes
- **RBAC**: Shared policy vocabulary (RUN_AI_ACTIONS, VIEW_TASKS, MANAGE_TASKS, etc.)
- **Audit**: npm audit in CI (critical = blocking)
- **Structured logging**: JSON logger with requestId for API routes (`lib/server/logger.ts`)
