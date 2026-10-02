#!/bin/sh
# Daily copy of the store database and photos. Run from cron as the azpawn user:
#   15 3 * * * /opt/azpawn/deploy/backup.sh
set -eu
DATA=/var/lib/azpawn
DEST=/var/backups/azpawn/$(date +%F)
mkdir -p "$DEST"
sqlite3 "$DATA/azpawn.sqlite3" ".backup '$DEST/azpawn.sqlite3'"
cp -r "$DATA/media" "$DEST/"
find /var/backups/azpawn -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} +
