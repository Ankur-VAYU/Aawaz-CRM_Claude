#!/bin/sh
# Restores a backup made by backup.sh into the running database. This REPLACES current data.
# Usage: scripts/restore.sh backups/nita_alumni-2026-10-03_0230.sql.gz
set -eu
cd "$(dirname "$0")/.."
[ -f "${1:-}" ] || { echo "Usage: $0 <backup.sql.gz>"; exit 2; }
printf 'This replaces all data in the database with %s. Type RESTORE to continue: ' "$1"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
docker compose exec -T db psql -U nita -d postgres -c 'DROP DATABASE IF EXISTS nita_alumni WITH (FORCE);' -c 'CREATE DATABASE nita_alumni;'
gunzip -c "$1" | docker compose exec -T db psql -U nita -d nita_alumni -q
echo "Restored $1"
