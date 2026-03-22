#!/bin/bash
set -euo pipefail

target="${1:-postgres}"

case "$target" in
  sqlite)
    cp prisma/schema.sqlite.prisma prisma/schema.prisma
    ;;
  postgres)
    cp prisma/schema.postgres.prisma prisma/schema.prisma
    ;;
  *)
    echo "Usage: $0 [sqlite|postgres]" >&2
    exit 1
    ;;
esac

./node_modules/.bin/prisma generate

if [ "$target" = "postgres" ]; then
  cat <<'EOF'
NOTE: prisma/migrations still reflects a SQLite-shaped lineage.
Do not treat `prisma migrate deploy` as a clean Postgres bootstrap path
until a new Postgres baseline migration is created and resolved.
EOF
fi
