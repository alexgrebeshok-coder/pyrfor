#!/bin/bash
set -euo pipefail

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
