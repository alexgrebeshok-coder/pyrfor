# CEOClaw Documentation

**Last Updated:** `2026-03-24`

This directory complements the root docs (`README.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `RUNBOOK.md`) and should follow the same source of truth.

---

## Overview

CEOClaw is a working AI-powered PM/ops dashboard with broad product surface area, live Vercel deployment surfaces, and ongoing foundation hardening.

### Current baseline

- **Web package version:** `0.1.0`
- **Frontend:** Next.js 15 + React 18 + TypeScript 5
- **Backend:** Next.js App Router + API routes + Prisma
- **Database posture:** SQLite default schema locally; Postgres hosted runtime path on Vercel
- **Automated tests:** `109/109` passing via `npm run test:run`
- **E2E posture:** Playwright exists, but CI currently defaults to `SKIP_E2E=true`
- **Security posture:** `npm audit --omit=dev` currently reports 2 production vulnerabilities (`jspdf` critical, `next` moderate)

---

## Recommended reading order

1. `../README.md` — current product posture and local/prod setup
2. `../PROJECT_STATUS.md` — operational truth and release blockers
3. `../ROADMAP.md` — execution tracks and gates
4. `../RUNBOOK.md` — deploy and health-check flow
5. `AI-RAG-SYSTEM.md` — AI/RAG subsystem notes
6. `mock-data.md` — legacy/local demo guidance only

---

## Quick start

```bash
# Clone repository
git clone https://github.com/alexgrebeshok-coder/ceoclaw.git
cd ceoclaw

# Setup environment for local Postgres-backed development
cp .env.example .env

# Install dependencies
npm install

# Initialize the local schema
npx prisma db push

# Start development server
npm run dev
```

---

## Hosted deployment posture

Hosted preview/production environments should use **Postgres**, not `file:./dev.db`.

```bash
# Prepare Prisma for hosted Postgres runtime
npm run prisma:prepare:production

# Validate locally
npm run build

# Deploy
vercel --prod

# Post-deploy smoke
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

### Important caveats

- Checked-in `prisma/schema.prisma` is now the shared Postgres schema for local and hosted runtimes.
- Production deploys run the same schema through `npm run prisma:prepare:production`, including baseline bootstrap and readiness checks.
- `DIRECT_URL` should be set alongside `DATABASE_URL` when Prisma migrations need a non-pooling connection.
- `CEOCLAW_SKIP_AUTH=true` is for controlled local/demo workflows only.

---

## Testing

```bash
# Automated baseline
npm run test:run

# CI-targeted Playwright smoke subset
npm run test:e2e:smoke

# Force full Playwright locally
npm run test:e2e:force

# Hosted smoke after deploy
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

---

## Support

- GitHub Issues: https://github.com/alexgrebeshok-coder/ceoclaw/issues
- Root docs remain the authoritative entry points for project status and deploy posture.
