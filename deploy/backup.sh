#!/bin/sh
# Daily copy of the store database and photos. Run from cron as the azpawn user:
#   15 3 * * * /opt/azpawn/deploy/backup.sh
set -eu
# Backups hold the customer database and photos: nothing here may be
# world-readable, regardless of the umask cron runs with.
umask 077
DATA=/var/lib/azpawn
DEST=/var/backups/azpawn/$(date +%F)
mkdir -p "$DEST"
sqlite3 "$DATA/azpawn.sqlite3" ".backup '$DEST/azpawn.sqlite3'"
cp -r "$DATA/media" "$DEST/"
# cp does not reliably mask source modes: enforce it explicitly.
chmod -R go-rwx "$DEST"
find /var/backups/azpawn -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} +
