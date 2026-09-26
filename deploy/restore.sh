#!/bin/sh
# Restores a dump into a NEW database next to the live one and never touches "taxi":
#   deploy/restore.sh deploy/backups/taxi-20261001T033000Z.dump taxi_restored
# Prints exact row counts per table so the copy can be compared with production.
# Switching production over to a restored copy is a deliberate, separate step:
# docs/runbook.md, "Restore from backup". Practise this monthly (docs/deploy.md, restore drill).
set -eu

DUMP="${1:?usage: restore.sh <dump file> <new database name>}"
TARGET="${2:?usage: restore.sh <dump file> <new database name>}"
COMPOSE="$(cd "$(dirname "$0")" && pwd)/compose.sh"

[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }
case "$TARGET" in
  taxi) echo "refusing to restore over the live database 'taxi'" >&2; exit 1 ;;
  *[!a-z0-9_]*) echo "database name: lowercase letters, digits and _ only" >&2; exit 1 ;;
esac

"$COMPOSE" exec -T postgres createdb -U taxi_owner "$TARGET"
# ownership goes to taxi_owner; grants to taxi_app come back with the dump (the role exists
# on every server: deploy/postgres/init-roles.sh)
"$COMPOSE" exec -T postgres pg_restore -U taxi_owner -d "$TARGET" --exit-on-error --no-owner \
  --role=taxi_owner < "$DUMP"

echo "restored into $TARGET; exact row counts:"
"$COMPOSE" exec -T postgres psql -U taxi_owner -d "$TARGET" -At -c "
  SELECT table_schema || '.' || table_name || ': ' || (xpath('/row/c/text()', query_to_xml(
           format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables
  WHERE table_schema IN ('public', 'taxi_meta') AND table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name"
echo "migrations recorded:"
"$COMPOSE" exec -T postgres psql -U taxi_owner -d "$TARGET" -At -c \
  "SELECT name FROM taxi_meta.schema_migrations ORDER BY name"
