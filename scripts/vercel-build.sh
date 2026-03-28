#!/bin/bash
set -euo pipefail

database_url="${DATABASE_URL:-${POSTGRES_PRISMA_URL:-${POSTGRES_URL:-}}}"
direct_url="${DIRECT_URL:-${POSTGRES_URL_NON_POOLING:-${POSTGRES_URL:-${database_url:-}}}}"
is_vercel_build="${VERCEL:-0}"
is_ci_build="${CI:-false}"

if [[ "$database_url" != postgresql://* && "$database_url" != postgres://* ]]; then
  echo "No production-ready Postgres URL is configured."
  echo "Checked DATABASE_URL, POSTGRES_PRISMA_URL and POSTGRES_URL."
  echo "Hosted and manual vercel-build flows now require Postgres."
  exit 1
fi

export DATABASE_URL="$database_url"
export DIRECT_URL="$direct_url"
echo "Using Postgres Prisma path for Vercel build."
npm run prisma:prepare:production
if [[ -n "${SEED_AUTH_EMAIL:-}" && -n "${SEED_AUTH_PASSWORD:-}" ]]; then
  echo "Seeding production auth user."
  npm run seed:auth
else
  echo "No production auth seed configured; skipping auth user seeding."
fi
npm run seed:production

next build
