#!/bin/sh
# Daily database backup for the docker-compose setup. Keeps the last 30 days.
# Schedule with cron, e.g.:  30 2 * * *  /opt/nita-alumni-patna/backend/scripts/backup.sh
# Copy the backups folder off the server as well (another machine or cloud storage):
# a backup on the same disk does not survive losing the server.
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/nita_alumni-$(date +%Y-%m-%d_%H%M).sql.gz"
docker compose exec -T db pg_dump -U nita -d nita_alumni --no-owner | gzip > "$file"
find backups -name 'nita_alumni-*.sql.gz' -mtime +30 -delete
echo "Saved $file"
