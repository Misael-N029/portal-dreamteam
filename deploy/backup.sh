#!/usr/bin/env bash
# Portal DreamTeam · respaldo diario de la base (guarda 14 días).
# Cron (como root):  30 3 * * * bash /var/www/portal/deploy/backup.sh >> /var/log/portal-backup.log 2>&1
set -euo pipefail
APP=/var/www/portal
DEST=/var/backups/portal
STAMP=$(date +%F)
mkdir -p "$DEST"
chmod 700 "$DEST"

DB_URL=$(grep '^DATABASE_URL=' "$APP/server/.env" | cut -d= -f2- | tr -d '"')
pg_dump "$DB_URL" --format=custom --file="$DEST/portal-db-$STAMP.dump"
# Imágenes y Excel de los últimos envíos (el worker borra solo los de más de 30 días)
[ -d "$APP/server/storage" ] && tar -czf "$DEST/portal-storage-$STAMP.tar.gz" -C "$APP/server" storage

find "$DEST" -name 'portal-*' -mtime +14 -delete
echo "$(date '+%F %T') respaldo listo"
