#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL must be set for ci:check}"
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://127.0.0.1:3000}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://127.0.0.1:3000}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-ci-local-secret}"
export DASHBOARD_API_KEY="${DASHBOARD_API_KEY:-ci-dashboard-key}"
export CEOCLAW_SKIP_AUTH="${CEOCLAW_SKIP_AUTH:-true}"
export CEOCLAW_E2E_AUTH_BYPASS="${CEOCLAW_E2E_AUTH_BYPASS:-true}"

npx prisma migrate deploy
npm run lint
npx tsc --noEmit
npm run test:run
npm run build
npm run ci:e2e
