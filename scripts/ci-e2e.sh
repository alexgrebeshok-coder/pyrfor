#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://127.0.0.1:3000}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://127.0.0.1:3000}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-ci-local-secret}"
export DASHBOARD_API_KEY="${DASHBOARD_API_KEY:-ci-dashboard-key}"
export CEOCLAW_SKIP_AUTH="${CEOCLAW_SKIP_AUTH:-true}"
export CEOCLAW_E2E_AUTH_BYPASS="${CEOCLAW_E2E_AUTH_BYPASS:-true}"
export PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-3000}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:${PLAYWRIGHT_PORT}}"
export PLAYWRIGHT_REUSE_EXISTING_SERVER="${PLAYWRIGHT_REUSE_EXISTING_SERVER:-false}"

node ./scripts/run-e2e.mjs \
  e2e/smoke.spec.ts \
  e2e/release/release-page.spec.ts \
  e2e/orchestration/control-plane.spec.ts \
  e2e/integration/project-task-reflection.spec.ts \
  --project=chromium
