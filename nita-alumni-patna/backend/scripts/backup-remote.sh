#!/bin/sh
# Backs up the hosted (Neon) database to backups/ on this computer.
# Needs pg_dump at the same or a newer major version than the database.
# Usage: scripts/backup-remote.sh   (reads DATABASE_URL from .env or the environment)
set -eu
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2-)
fi
[ -n "${DATABASE_URL:-}" ] || { echo "Set DATABASE_URL (in .env or the environment)"; exit 2; }
mkdir -p backups
file="backups/nita_alumni-$(date +%Y-%m-%d_%H%M).sql.gz"
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$file"
echo "Saved $file ($(du -h "$file" | cut -f1)). Copy it somewhere safe, away from this computer."
