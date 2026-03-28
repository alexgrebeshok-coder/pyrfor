#!/bin/bash
set -euo pipefail

resolved_database_url="${DATABASE_URL:-${POSTGRES_PRISMA_URL:-${POSTGRES_URL:-}}}"
resolved_direct_url="${DIRECT_URL:-${POSTGRES_URL_NON_POOLING:-${POSTGRES_URL:-${resolved_database_url:-}}}}"

if [[ -n "${resolved_database_url}" ]]; then
  export DATABASE_URL="${resolved_database_url}"
fi

if [[ -n "${resolved_direct_url}" ]]; then
  export DIRECT_URL="${resolved_direct_url}"
fi

./node_modules/.bin/prisma generate
node ./scripts/ensure-postgres-migration-state.mjs
