#!/bin/bash
set -euo pipefail

database_url="${DATABASE_URL:-}"

if [[ "$database_url" == postgresql://* || "$database_url" == postgres://* ]]; then
  echo "Using Postgres Prisma path for Vercel build."
  npm run prisma:prepare:production
  npm run seed:production
else
  echo "No Postgres DATABASE_URL configured; using SQLite fallback for preview/local Vercel build."
  cp prisma/schema.sqlite.prisma prisma/schema.prisma
  ./node_modules/.bin/prisma generate
  echo "Skipping production seed because preview/local build is using SQLite."
fi

next build
