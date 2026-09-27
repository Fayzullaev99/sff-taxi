#!/bin/sh
# Nightly database backup. Schedule on the host (docs/deploy.md), e.g. /etc/cron.d/sff-taxi:
#   30 3 * * * root /opt/sff-taxi/deploy/backup.sh >> /var/log/sff-taxi-backup.log 2>&1
#
# 1. pg_dump (custom format, compressed) of the live database into deploy/backups/
# 2. verifies the dump can be listed (a corrupt dump fails loudly before old ones rotate away)
# 3. deletes local dumps older than BACKUP_RETENTION_DAYS (default 14)
# 4. copies the dump off the server with rclone when BACKUP_RCLONE_REMOTE is set, and prunes
#    remote dumps older than BACKUP_REMOTE_RETENTION_DAYS (default 60)
# 5. with the seaweedfs profile and BACKUP_FILES=true: an archive of the file store (driver
#    documents and photos) next to the dump, rotated and copied off-site the same way
# 6. pings BACKUP_PING_URL (dead-man switch) when everything above worked
# Settings are read from deploy/.env.prod (or TAXI_ENV_FILE). Redis is not backed up: it only
# holds caches, rate limits, GPS trails and short-lived tickets.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${TAXI_ENV_FILE:-$DIR/.env.prod}"
COMPOSE="$DIR/compose.sh"

# one value from the env file without sourcing it (values may contain spaces)
env_get() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

RETENTION_DAYS="$(env_get BACKUP_RETENTION_DAYS)"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
REMOTE="$(env_get BACKUP_RCLONE_REMOTE)"
REMOTE_RETENTION_DAYS="$(env_get BACKUP_REMOTE_RETENTION_DAYS)"
REMOTE_RETENTION_DAYS="${REMOTE_RETENTION_DAYS:-60}"
PING_URL="$(env_get BACKUP_PING_URL)"
FILES="$(env_get BACKUP_FILES)"

BACKUP_DIR="${BACKUP_DIR:-$DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/taxi-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

fail() {
  echo "$(date -u +%FT%TZ) backup FAILED: $1" >&2
  if [ -n "$PING_URL" ]; then
    curl -fsS -m 10 --retry 3 "$PING_URL/fail" > /dev/null 2>&1 || true
  fi
  exit 1
}

# pg_dump runs inside the container over the local socket; the dump streams out to the host
"$COMPOSE" exec -T postgres pg_dump -U taxi_owner -d taxi --format=custom --compress=9 \
  > "$FILE.partial" || fail "pg_dump exited with an error"
[ -s "$FILE.partial" ] || fail "empty dump"
"$COMPOSE" exec -T postgres pg_restore --list < "$FILE.partial" > /dev/null \
  || fail "dump cannot be read back"
mv "$FILE.partial" "$FILE"

find "$BACKUP_DIR" -name 'taxi-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'taxi-*.dump.partial' -mtime +1 -delete

if [ -n "$REMOTE" ]; then
  command -v rclone > /dev/null || fail "BACKUP_RCLONE_REMOTE is set but rclone is not installed"
  rclone copy --no-traverse "$FILE" "$REMOTE" || fail "off-site copy to $REMOTE"
  rclone delete --min-age "${REMOTE_RETENTION_DAYS}d" --include 'taxi-*.dump' "$REMOTE" \
    || echo "warning: pruning $REMOTE failed" >&2
fi

# The file store: SeaweedFS keeps its data in the s3data volume. The archive is taken while it
# runs (uploads are rare and each file is written once): a file uploaded during the copy may be
# missing, never a half-written older one.
if [ "$FILES" = true ]; then
  # the compose project: sff-taxi-prod (deploy/docker-compose.prod.yml) unless overridden
  VOLUME="${COMPOSE_PROJECT_NAME:-sff-taxi-prod}_s3data"
  ARCHIVE="$BACKUP_DIR/taxi-files-$STAMP.tar.gz"
  docker run --rm -v "$VOLUME:/data:ro" alpine:3 tar -czf - -C /data . > "$ARCHIVE.partial" \
    || fail "archive of the file store ($VOLUME)"
  [ -s "$ARCHIVE.partial" ] || fail "empty file store archive"
  mv "$ARCHIVE.partial" "$ARCHIVE"
  find "$BACKUP_DIR" -name 'taxi-files-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
  find "$BACKUP_DIR" -name 'taxi-files-*.tar.gz.partial' -mtime +1 -delete
  if [ -n "$REMOTE" ]; then
    rclone copy --no-traverse "$ARCHIVE" "$REMOTE" || fail "off-site copy of the file store"
    rclone delete --min-age "${REMOTE_RETENTION_DAYS}d" --include 'taxi-files-*.tar.gz' "$REMOTE" \
      || echo "warning: pruning file archives on $REMOTE failed" >&2
  fi
  echo "$(date -u +%FT%TZ) file store ok: $(basename "$ARCHIVE") ($(du -h "$ARCHIVE" | cut -f1))"
fi

[ -n "$PING_URL" ] && { curl -fsS -m 10 --retry 3 "$PING_URL" > /dev/null || echo "warning: ping failed" >&2; }
echo "$(date -u +%FT%TZ) backup ok: $(basename "$FILE") ($(du -h "$FILE" | cut -f1))${REMOTE:+, copied to $REMOTE}"
