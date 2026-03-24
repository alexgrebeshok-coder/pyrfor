# CEOClaw — AI-Powered Project Management Dashboard

**Version:** `0.3.0` (foundation hardening)  
**Status:** Working product; PostgreSQL migration and killer features (AI Actions, Telegram, Voice) in progress  
**Updated:** `2026-03-24`  
**Repository:** https://github.com/alexgrebeshok-coder/ceoclaw  
**License:** MIT

---

## 🎯 О проекте

**CEOClaw** — AI-powered PM dashboard для управления проектами, аналитикой, рисками, документами и операционной координацией.

Система уже работает как реальный продукт: есть живые Vercel deployment surfaces, 131 API route, строгий TypeScript, автоматические тесты и production/deployment runbooks. При этом foundation ещё не готова к честному ярлыку вроде `1.0.0 MVP Ready` или `Production Ready`.

---

## 📌 Статус на сейчас

| Signal | Current state |
|---|---|
| Stage progress | Этап 1 + 1.5 закрыты примерно на `95%` |
| Deployments | Vercel `prod` и `preview` живы |
| API surface | `131` Next.js route handlers |
| Automated tests | `109/109` passing via `npm run test:run` |
| Build | Clean `npm run build` passes |
| TypeScript | `strict: true` in `tsconfig.json` |
| E2E posture | Playwright suite exists; CI defaults to `SKIP_E2E=false` (smoke tests run on push) |
| Security posture | `npm audit --omit=dev` reports `0` production vulnerabilities |
| Database posture | Checked-in Prisma default remains SQLite for local/dev; Vercel production switches to Postgres via build-time prep; Postgres migration baseline still needs cleanup |

### Что уже крепко стоит

- Dashboard, projects, tasks, risks, briefs, approvals, connectors и operational surfaces собраны в одном продукте.
- AI chat, export/import, rollout/readiness, evidence/work-report surfaces уже интегрированы в основной UX.
- Production build и Vitest baseline проходят.
- Есть runbook'и для deploy, health-check и post-deploy smoke.

### Что ещё блокирует честный release-ready статус

- Нужно довести PostgreSQL path до чистого, не тактического состояния.
- Нужно убрать SQLite bridge из production story.
- Нужно реализовать AI Actions (создание задач/рисков из AI chat).
- Нужно стабилизировать Telegram Bot (webhook mode, voice input).
- Нужно добавить Approval workflow и Auto Reports.

---

## 🏗️ Архитектура

```text
┌─────────────────────────────────────────────────────────────┐
│                      CEOClaw Dashboard                      │
│                   (Next.js 15 + React 18)                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                     ↓                     ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Frontend    │    │   Backend     │    │  AI Engine    │
│   (React)     │    │  (Next.js)    │    │  (Providers)  │
└───────────────┘    └───────────────┘    └───────────────┘
        ↓                     ↓                     ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Components   │    │    Prisma     │    │ OpenRouter /  │
│  Dashboard    │    │ SQLite default│    │ ZAI / local   │
│  Workflow     │    │ Postgres deploy│   │ MLX fallback  │
│  Operations   │    │ path on Vercel│    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

### Database reality check

- Локально checked-in `prisma/schema.prisma` по умолчанию использует SQLite.
- Для production/Vercel используется `npm run prisma:prepare:production`, который переключает Prisma на Postgres schema variant и подготавливает runtime.
- `prisma migrate deploy` intentionally remains disabled by default until a clean Postgres baseline is rebuilt.

---

## 💻 Технологии

### Frontend

- **Next.js 15.5.12**
- **React 18**
- **TypeScript 5** (`strict: true`)
- **Tailwind CSS 3.4**
- **shadcn/ui**
- **Recharts**

### Backend

- **Next.js App Router + API Routes**
- **Prisma ORM**
- **SQLite** — local/default checked-in schema
- **PostgreSQL** — intended Vercel runtime path
- **NextAuth.js**

### AI / Ops

- **OpenRouter**, **ZAI**, optional **OpenAI**
- **Local MLX** for macOS/local workflows
- **Vitest** for automated tests
- **Playwright** for E2E and smoke coverage
- **HTTP post-deploy smoke** via `npm run smoke:postdeploy`

---

## ⚙️ Функциональные области

- **Portfolio / Dashboard** — KPI, health, activity, quick actions
- **Projects / Tasks / Gantt / Calendar** — execution tracking and dependencies
- **Risks / Analytics / Finance** — PMO and portfolio insight surfaces
- **AI Chat / AI Runs / Evidence** — analysis, summaries, run traceability
- **Connectors / Telegram / Email / 1C / GPS** — external delivery and ingestion surfaces
- **Work Reports / Pilot Review / Tenant Readiness** — operational control workflows

---

## 🚀 Локальный запуск

```bash
# 1. Clone
git clone https://github.com/alexgrebeshok-coder/ceoclaw.git
cd ceoclaw

# 2. Local env
cp .env.example .env

# 3. Install
npm install

# 4. Apply the Postgres schema
npx prisma db push

# 5. Start app
npm run dev
```

Локальная разработка теперь использует тот же Postgres-first Prisma schema, что и hosted runtime. Для controlled local/demo flows можно дополнительно включать dev auth bypass через `CEOCLAW_SKIP_AUTH=true`.

---

## 🌐 Production / Vercel posture

```bash
# 1. Configure production Postgres env vars
# DATABASE_URL / DIRECT_URL or Vercel POSTGRES_* variables

# 2. Prepare Prisma for Postgres
npm run prisma:prepare:production

# 3. Verify build locally
npm run build

# 4. Deploy
vercel --prod

# 5. Run post-deploy smoke against the deployed URL
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

### Important production notes

- Local, preview, and production environments now use the same Postgres Prisma schema.
- `npm run prisma:prepare:production` regenerates Prisma Client, bootstraps/repairs legacy Postgres state when needed, and runs `prisma migrate deploy` against the committed Postgres baseline.
- `DIRECT_URL` should point to a direct/non-pooling Postgres connection when one is available.
- See `RUNBOOK.md`, `DEPLOY.md`, and `DEPLOYMENT.md` for operator details.

---

## 🔧 Environment variables

```bash
# Local development
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
DIRECT_URL="postgresql://user:pass@host/db?sslmode=require"
CEOCLAW_SKIP_AUTH="true"   # local/dev only
NEXTAUTH_URL="http://localhost:3000"

# Production / Vercel
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
DIRECT_URL="postgresql://user:pass@host/db?sslmode=require"
POSTGRES_PRISMA_URL="postgresql://user:pass@host/db?sslmode=require"
POSTGRES_URL="postgresql://user:pass@host/db?sslmode=require"
NEXTAUTH_SECRET="replace-me"
NEXTAUTH_URL="https://your-app.vercel.app"

# AI providers
OPENROUTER_API_KEY="..."
ZAI_API_KEY="..."
OPENAI_API_KEY="..."
```

**Do not** set `CEOCLAW_SKIP_AUTH=true` in production.

---

## 🧪 Проверка качества

```bash
# Unit/integration baseline
npm run test:run

# CI-targeted Playwright smoke subset
npm run test:e2e:smoke

# Force full Playwright run locally even if SKIP_E2E=true
npm run test:e2e:force

# Post-deploy smoke against a live URL
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy

# Production build
npm run build
```

### E2E caveat

Playwright suite уже существует, но CI сейчас по умолчанию идёт через `SKIP_E2E=true`, чтобы flaky infrastructure не блокировала merge/deploy. Возврат полноценного E2E gate остаётся отдельной quality-задачей.

---

## 🗺️ Исполнительный roadmap

### Phase 0 — Foundation Lock (текущий)

- [x] `p0-docs-sync` — документация синхронизирована с реальностью
- [x] `p0-security` — 0 production vulnerabilities
- [ ] `p0-postgres-migration` — PostgreSQL как canonical production DB
- [x] `p0-e2e-recovery` — Playwright smoke в CI (SKIP_E2E=false)

### Phase 1 — AI Actions + Telegram (next)

- [ ] `p1-ai-actions` — AI chat создаёт задачи, риски, обновляет проекты (native function calling)
- [ ] `p1-telegram-stabilize` — Telegram Bot webhook mode, /brief /tasks /voice
- [ ] `p1-voice-to-task` — Telegram audio → Whisper API → задача на дашборде
- [ ] `p1-morning-briefing` — Vercel Cron → персонализированный утренний брифинг

### Phase 2 — Evidence + Approval + Reports

- [ ] `p2-evidence-ai` — AI рекомендации с evidence и confidence scoring
- [ ] `p2-approval-workflow` — Approval queue, audit trail, Telegram notifications
- [ ] `p2-auto-reports` — Executive pack PDF/HTML, PMO summary

### Phase 3 — Polish + Launch

- [ ] `p3-settings-admin` — Connector management, usage dashboard
- [ ] `p3-realtime-sse` — Real-time SSE updates для task/project changes
- [ ] `p3-map-stabilize` — Проекты на карте с цветовым кодированием
- [ ] `p3-bundle-typescript` — Bundle optimization, TypeScript cleanup
- [ ] `p3-postdeploy-monitoring` — Post-deploy smoke + Sentry

---

## 📚 Ключевые документы

- `PROJECT_STATUS.md` — current operational truth
- `PROJECT_SUMMARY.md` — quick reference card
- `ROADMAP.md` — execution tracks and release gates
- `RUNBOOK.md` — operator deploy flow
- `DEPLOY.md` / `DEPLOYMENT.md` — production deployment notes
- `docs/AI-RAG-SYSTEM.md` — AI/RAG subsystem notes

---

*CEOClaw is already real software. This repository should describe that reality accurately: strong product surface, unfinished foundation.*
