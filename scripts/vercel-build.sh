#!/bin/bash
set -euo pipefail

database_url="${DATABASE_URL:-}"
is_vercel_build="${VERCEL:-0}"
is_ci_build="${CI:-false}"

if [[ "$database_url" == postgresql://* || "$database_url" == postgres://* ]]; then
  echo "Using Postgres Prisma path for Vercel build."
  npm run prisma:prepare:production
  node ./scripts/check-production-db-readiness.mjs
  if [[ -n "${SEED_AUTH_EMAIL:-}" && -n "${SEED_AUTH_PASSWORD:-}" ]]; then
    echo "Seeding production auth user."
    npm run seed:auth
  else
    echo "No production auth seed configured; skipping auth user seeding."
  fi
  npm run seed:production
else
  if [[ "$is_vercel_build" == "1" || "$is_ci_build" == "true" ]]; then
    echo "DATABASE_URL is not configured for a production-ready Postgres build."
    echo "Refusing to fall back to SQLite on Vercel/CI because runtime would ship unhealthy."
    exit 1
  fi

  echo "No Postgres DATABASE_URL configured; using SQLite fallback for local vercel-build only."
  export DATABASE_URL="${database_url:-file:./dev.db}"
  cp prisma/schema.sqlite.prisma prisma/schema.prisma
  ./node_modules/.bin/prisma generate
  ./node_modules/.bin/prisma db push --skip-generate
  npm run seed:preview-auth
  npm run seed:preview-data
fi

next build
