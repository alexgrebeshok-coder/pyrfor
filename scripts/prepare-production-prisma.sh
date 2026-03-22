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

cp prisma/schema.postgres.prisma prisma/schema.prisma
./node_modules/.bin/prisma generate

if [ "${CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY:-false}" = "true" ]; then
  echo "Running prisma migrate deploy because CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY=true"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "Skipping prisma migrate deploy."
  echo "Committed prisma/migrations are not yet a verified Postgres baseline."
  echo "Enable CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY=true only after rebuilding the Postgres migration baseline."
fi
