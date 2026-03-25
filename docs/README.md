# CEOClaw Documentation

**Last Updated:** `2026-03-25`

This directory complements the root docs and should stay aligned with them:

- `../README.md`
- `../PROJECT_STATUS.md`
- `../ROADMAP.md`
- `../ARCHITECTURE.md`
- `../RUNBOOK.md`

---

## Overview

CEOClaw is a working PM / ops platform with live deployment paths, broad operational surfaces, and a green repo-native validation baseline.

### Current baseline

- **Web package version:** `0.1.0`
- **Frontend:** Next.js 15 + React 18 + TypeScript 5
- **Backend:** Next.js App Router + API routes + Prisma
- **Database posture:** Postgres-first Prisma schema + committed migrations; SQLite bridge removed from active production paths
- **Automated tests:** `132/132` passing via `npm run test:run`
- **E2E posture:** CI defaults to targeted smoke coverage; `SKIP_E2E=true` is emergency opt-out, not the default story
- **Security posture:** `npm audit --omit=dev` reports `0` production vulnerabilities

---

## Recommended reading order

1. `../README.md` — product posture and local/prod setup
2. `../PROJECT_STATUS.md` — operational truth and remaining blocker
3. `../ROADMAP.md` — current closeout roadmap state
4. `../ARCHITECTURE.md` — current architecture snapshot
5. `../RUNBOOK.md` — deploy and operator flows
6. domain-specific docs in this directory as needed

---

## Quick start

```bash
# Clone repository
git clone https://github.com/alexgrebeshok-coder/ceoclaw.git
cd ceoclaw

# Setup environment for local Postgres-backed development
cp .env.example .env
export DATABASE_URL='postgresql://user:pass@localhost:5432/ceoclaw'
export DIRECT_URL='postgresql://user:pass@localhost:5432/ceoclaw'

# Install dependencies
npm install

# Initialize Prisma client and schema
npx prisma generate
npx prisma migrate deploy

# Start development server
npm run dev
```

---

## Hosted deployment posture

Hosted preview/production environments should use Postgres and follow the runbook/deploy docs.

```bash
# Validate locally against Postgres env vars
DATABASE_URL='postgresql://user:pass@localhost:5432/ceoclaw' \
DIRECT_URL='postgresql://user:pass@localhost:5432/ceoclaw' \
npm run build

# Deploy
vercel --prod

# Post-deploy smoke
BASE_URL='https://your-app.vercel.app' npm run smoke:postdeploy
```

### Important notes

- Checked-in Prisma schema and committed migrations now describe the shared Postgres-first baseline.
- `DIRECT_URL` should be set alongside `DATABASE_URL` when Prisma needs a direct/non-pooling connection.
- `CEOCLAW_SKIP_AUTH=true` is for controlled local/demo workflows only.
- The last remaining old-roadmap blocker is external disposable Postgres bootstrap validation.

---

## Testing

```bash
# Automated baseline
npm run lint
npm run test:run

# CI-targeted Playwright smoke subset
npm run test:e2e:smoke

# Force full Playwright locally
npm run test:e2e:force

# Hosted smoke after deploy
BASE_URL='https://your-app.vercel.app' npm run smoke:postdeploy
```

---

## Support

- GitHub Issues: https://github.com/alexgrebeshok-coder/ceoclaw/issues
- Root docs remain the authoritative entry points for project status, architecture, and deploy posture.
