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

# E2E tier system:
#   Tier 1 (smoke/critical) — always runs in CI
#   Tier 2 (feature)        — runs in CI on main branch
#   Tier 3 (optional)       — runs on schedule or explicit flag

TIER="${E2E_TIER:-2}"

# Tier 1: smoke & critical flows
TIER1_SPECS=(
  e2e/smoke.spec.ts
  e2e/release/release-page.spec.ts
  e2e/orchestration/control-plane.spec.ts
  e2e/integration/project-task-reflection.spec.ts
  e2e/critical-flows.spec.ts
  e2e/errors/404.spec.ts
  e2e/errors/boundary.spec.ts
)

# Tier 2: feature-level coverage
TIER2_SPECS=(
  e2e/dashboard/navigation.spec.ts
  e2e/dashboard/kpi-cards.spec.ts
  e2e/dashboard/goals-summary.spec.ts
  e2e/projects/list.spec.ts
  e2e/projects/create.spec.ts
  e2e/projects/detail.spec.ts
  e2e/tasks/list.spec.ts
  e2e/tasks/create.spec.ts
  e2e/tasks/kanban.spec.ts
  e2e/goals/goals-page.spec.ts
  e2e/chat/chat-page.spec.ts
  e2e/documents/documents-page.spec.ts
  e2e/field-operations/field-operations-page.spec.ts
  e2e/portfolio/portfolio-cockpit.spec.ts
)

# Tier 3: optional (mobile, accessibility, settings)
TIER3_SPECS=(
  e2e/mobile/mobile-tab-bar.spec.ts
  e2e/settings/theme.spec.ts
  e2e/settings/language.spec.ts
  e2e/accessibility/a11y.spec.ts
)

SPECS=("${TIER1_SPECS[@]}")

if [ "$TIER" -ge 2 ]; then
  SPECS+=("${TIER2_SPECS[@]}")
fi

if [ "$TIER" -ge 3 ]; then
  SPECS+=("${TIER3_SPECS[@]}")
fi

echo "Running E2E tier $TIER (${#SPECS[@]} specs)"

node ./scripts/run-e2e.mjs \
  "${SPECS[@]}" \
  --project=chromium
