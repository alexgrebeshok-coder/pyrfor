# CEOClaw Operator Runbook

This runbook covers deploys that use `npm run vercel-build`, Prisma migrations, and the production seed.

## Before a deploy

1. Confirm the migration folder exists and contains SQL files:
   ```bash
   ls prisma/migrations
   ```

2. Confirm production environment variables are set in Vercel:
   - `DATABASE_URL` or Vercel Postgres system envs such as `POSTGRES_PRISMA_URL`
   - `DIRECT_URL` or `POSTGRES_URL_NON_POOLING`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
   - one AI provider key

3. Review the production seed if the release changes board or task defaults.

## Preview deploy mode

Vercel previews must use a disposable Postgres database if you want the deployed dashboard to stay healthy.

- Do **not** set `DATABASE_URL=file:./dev.db` in a hosted Vercel Preview environment. The build may succeed, but runtime will ship without a production-safe database.
- Use a preview-only Postgres `DATABASE_URL` instead.
- `CEOCLAW_SKIP_AUTH=true` is acceptable only for controlled preview/demo environments.
- Do not copy the production `DATABASE_URL` into Preview just to make dashboards load; that would point preview builds at live writable data.

## Launch checklist

Use this checklist before marking a release candidate ready:

1. Sign in with a real account and confirm the shell loads without auth regressions.
2. Open `/api/health` and verify:
   - `status` is `healthy` or `degraded`, not `unhealthy`
   - `checks.database.status` is `connected`
   - `checks.ai.status` is `available` when a provider is configured
3. Confirm at least one AI provider is configured in production env vars.
4. Open **Settings** and save a preference change, then reload to confirm persistence.
5. Verify basic project/task CRUD:
   - create a project
   - create a task
   - update a task
   - delete or archive the test task if the flow exists in the target environment
6. Open `/gantt` and confirm the chart loads live data, renders dependencies, and handles empty/error states.
7. Open `/calendar` and confirm live tasks appear, event details open on click, and the empty/error states behave correctly.

If any of the checks above fail, do not promote the build to release-candidate status until the failure is explained and fixed.

## Deploy flow

Vercel runs:

```bash
npm run prisma:prepare:production
npm run seed:production
next build
```

`npm run prisma:prepare:production` resolves `DATABASE_URL` / `POSTGRES_PRISMA_URL` plus `DIRECT_URL` / `POSTGRES_URL_NON_POOLING`, regenerates Prisma Client from the checked-in Postgres schema, then runs `scripts/ensure-postgres-migration-state.mjs`.

`scripts/ensure-postgres-migration-state.mjs` handles three cases:

- fresh Postgres databases that only need the committed baseline applied;
- legacy Postgres databases that have runtime tables but no `_prisma_migrations`;
- already-migrated Postgres databases that just need a normal `prisma migrate deploy`.

The bootstrap flow still uses the existing idempotent repair/readiness scripts so deploys fail early when Postgres is reachable but the runtime-critical CEOClaw schema still does not match current Prisma expectations.

`prisma migrate deploy` is now part of the default hosted bootstrap path through the committed Postgres baseline migration.

## Post-deploy checks

1. Open `/api/health`.
2. Confirm the response is `healthy`.
3. Check that:
   - `checks.database.status` is `connected`
   - `checks.ai.status` is `available` or `no providers`
   - `checks.storage.status` is `ok`

Example:

```bash
curl https://your-app.vercel.app/api/health
```

## Seed behavior

`prisma/seed-production.ts` is safe to rerun:

- it creates the board only if missing
- it updates column metadata to match the canonical seed
- it creates missing tasks and updates existing tasks to deterministic values
- task due dates are derived from the project start date, so they do not drift between deploys

## Common issues

### `prisma migrate deploy` fails

Check:

- the Postgres baseline migration is present in `prisma/migrations/`
- `DIRECT_URL` points to a reachable Postgres instance
- the deployment logs show `ensure-postgres-migration-state.mjs` completing its repair/resolve step first

### `/api/health` returns `503`

Check:

- Postgres connectivity
- schema readiness across runtime-critical fields (for example `Document.title`, `TeamMember.allocated`, `Notification.readAt`, `Column.title`, `TaskDependency.dependsOnTaskId`, `_ProjectToTeamMember`)
- Prisma client generation
- the latest Vercel deployment logs

### Sentry build warnings

`npm run build` now initializes Sentry through the Next.js instrumentation files:

- `instrumentation.ts`
- `instrumentation-client.ts`

If build logs ever start mentioning the legacy `sentry.server.config.ts` or `sentry.client.config.ts` filenames again, check that those root-level files were not reintroduced and that `next.config.mjs` still wraps the app with `withSentryConfig(...)`.

### Build fails during seed

Check:

- the target database already has the expected tables
- there is at least one project in the database
- the production schema matches the live Postgres database state

## Rollback

If a deploy is unhealthy, redeploy the previous known-good Vercel deployment.

If the issue is a bad migration, fix it with a forward migration rather than editing already-applied SQL in place.
