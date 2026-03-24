# CEOClaw Deployment Guide

**Updated:** `2026-03-24`

This file is a short deployment companion. For the authoritative operator flow, see `RUNBOOK.md` and `DEPLOY.md`.

---

## Prerequisites

- Vercel project configured
- Hosted Postgres database (for example Neon)
- Required environment variables configured
- At least one AI provider key configured

---

## Required environment variables

In Vercel, configure at minimum:

- `DATABASE_URL` or hosted `POSTGRES_*` variables
- `DIRECT_URL` or `POSTGRES_URL_NON_POOLING`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- one AI provider key such as `OPENROUTER_API_KEY` or `ZAI_API_KEY`

---

## Deployment flow

```bash
# 1. Prepare Prisma for Postgres
npm run prisma:prepare:production

# 2. Validate the production build locally
npm run build

# 3. Deploy to Vercel
vercel --prod

# 4. Run post-deploy smoke against the deployed URL
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

### What the hosted build path actually does

The production/Vercel flow is Postgres-first and relies on the build/prep scripts rather than the checked-in local SQLite default:

- `npm run prisma:prepare:production`
- `node ./scripts/repair-production-schema.mjs`
- `node ./scripts/check-production-db-readiness.mjs`
- `npm run seed:production`
- `next build`

### Important caveat

`prisma migrate deploy` is intentionally **not** the default deploy step yet. The Postgres migration baseline still needs to be rebuilt and verified before it can be treated as the safe default path.

---

## Post-deploy checks

1. Run automated smoke validation:
   ```bash
   BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
   ```
2. Verify `GET /api/health` reports `healthy` or an explicitly acceptable `degraded` status.
3. Spot-check login, dashboard, and release surfaces in a browser if smoke reports warnings.

> GitHub Actions also runs the same HTTP-based post-deploy smoke after the production deploy job succeeds.

---

## Troubleshooting

- **Build fails:** check Postgres env vars and Prisma prep flow
- **Database error:** verify hosted Postgres connectivity and schema readiness
- **500 responses after deploy:** check Vercel logs and `/api/health`
- **Unexpected database behavior in hosted env:** confirm the deployment received the intended Postgres `DATABASE_URL` / `DIRECT_URL`
