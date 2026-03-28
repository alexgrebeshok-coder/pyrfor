# CEOClaw — AI-powered PM / Ops Platform

**Version:** `0.1.0` (web app package)
**Status:** Working product; old in-repo roadmap is closed except for external Postgres bootstrap validation
**Updated:** `2026-03-25`

---

## What CEOClaw is

**CEOClaw** is a Next.js 15 PM / ops platform for portfolio execution, task management, work reports, evidence-ledger operations, approvals, connectors, and AI-assisted decision support.

This repository is no longer a fragile MVP shell. It already ships a broad product surface with live deployment paths, strict TypeScript, a clean production build, and a real validation baseline.

At the same time, it is still inaccurate to label the repo `Production Ready` until the committed Postgres migration path is rerun against a disposable real Postgres environment and recorded cleanly.

---

## Current reality

| Signal | Current state |
|---|---|
| App / API routes | `131` |
| Automated tests | `132/132` passing via `npm run test:run` |
| Production build | clean against Postgres env vars |
| TypeScript posture | `strict: true` |
| Production vulnerabilities | `0` via `npm audit --omit=dev` |
| Deploy story | Vercel `prod` + `preview`, post-deploy smoke restored |
| Database posture | Postgres-first Prisma schema + committed migrations; SQLite bridge removed from active production paths |
| Work-report delivery | approved-only signal packets, markdown/JSON export, Telegram + email handoff via delivery ledger |
| Evidence / truth layer | persisted evidence ledger, on-demand evidence analysis, reconciliation casefiles |
| Task dependency UX | dependency badges + live dependency workspace in `/tasks` and project boards |
| Role-aware UI | permission gating expanded beyond work reports into approvals, integrations, tasks, projects, topbar quick actions, and kanban add flows |

---

## What is already shipped

- Portfolio / dashboard / analytics / risks / finance surfaces.
- Projects, tasks, gantt, calendar, and dependency-aware task workflows.
- Route-aware AI runtime with lazy client boundaries and AI run tracing.
- Work-report review workspace with approval convergence and canonical review flow.
- Approved-only signal packet generation with markdown/JSON export.
- Telegram and email signal-packet delivery through the shared delivery ledger.
- Evidence ledger operator UX with filters, selected-record inspection, and on-demand analysis.
- Reconciliation casefiles that connect finance, field evidence, and telemetry truth.
- Workspace + permission-aware UI gating aligned with API permissions for key mutation paths.
- CI-targeted E2E smoke plus post-deploy smoke coverage.

---

## What is still not closed

### External blocker from the old roadmap

- **`a2-cutover-validate`** — rerun the committed Postgres migration/bootstrap path against a disposable real Postgres instance and verify that:
  - schema applies cleanly from scratch;
  - no drift remains;
  - runbook claims are still accurate.

### Follow-on quality work after roadmap closeout

These are no longer foundation-rescue items, but they are still sensible follow-on work:

- grow Playwright confidence beyond smoke;
- keep docs synced as the architecture evolves;
- continue bundle / page-weight optimization where it matters;
- treat any new roadmap as net-new scope, not unfinished old-plan debt.

---

## Architecture snapshot

```text
┌────────────────────────────────────────────────────────────┐
│                    CEOClaw (Next.js 15)                   │
│     portfolio + delivery + evidence + approvals + AI      │
└────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌────────────────┐    ┌──────────────────┐
│ Client routes │    │ API / services │    │ Policy / access  │
│ route-aware   │    │ work reports   │    │ workspaces +     │
│ AIProvider    │    │ evidence / ops │    │ permissions       │
└───────────────┘    └────────────────┘    └──────────────────┘
        │                     │                     │
        └──────────────┬──────┴──────────────┬──────┘
                       ▼                     ▼
              ┌────────────────┐    ┌──────────────────┐
              │ Prisma +       │    │ External channels │
              │ Postgres-first │    │ Telegram / Email  │
              │ schema/migrate │    │ GPS / 1C / etc.   │
              └────────────────┘    └──────────────────┘
```

See `ARCHITECTURE.md` for the current architecture snapshot and major operational flows.

---

## Local development

```bash
# 1. Install
npm install

# 2. Copy local env
cp .env.example .env

# 3. Configure a local/disposable Postgres database
export DATABASE_URL='postgresql://user:pass@localhost:5432/ceoclaw'
export DIRECT_URL='postgresql://user:pass@localhost:5432/ceoclaw'

# 4. Prepare Prisma client and schema
npx prisma generate
npx prisma migrate deploy

# 5. Start the app
npm run dev
```

### Local notes

- `CEOCLAW_SKIP_AUTH=true` is only for local/demo flows.
- If you are using a disposable scratch database while iterating locally, `npx prisma db push` can still be useful, but the committed migration path is the canonical production story.

---

## Verification commands

```bash
# Lint
npm run lint

# Test baseline
npm run test:run

# Production build against Postgres env vars
DATABASE_URL='postgresql://user:pass@localhost:5432/ceoclaw' \
DIRECT_URL='postgresql://user:pass@localhost:5432/ceoclaw' \
npm run build

# Post-deploy smoke against a live URL
BASE_URL='https://your-app.vercel.app' npm run smoke:postdeploy

# Release preflight and install-hub smoke
npm run release:status
npm run xcode:status
npm run release:smoke
```

---

## Key documents

- `PROJECT_STATUS.md` — current status and remaining blocker.
- `ARCHITECTURE.md` — current architecture snapshot.
- `ROADMAP.md` — honest closeout roadmap state.
- `RUNBOOK.md` — operational runbook.
- `DEPLOY.md` / `DEPLOYMENT.md` — deployment details.
- `docs/dashboard-visual-baseline.md` — locked visual baseline for the main dashboard entry screen.

---

## Bottom line

**Correct label today:** working product with a broad operational surface and green repo-native validation.

**Incorrect label today:** `1.0.0 MVP Ready` or unconditional `Production Ready`.

The old roadmap is effectively finished in repository code. The only remaining old-plan blocker is external Postgres bootstrap validation in a disposable real Postgres environment.
