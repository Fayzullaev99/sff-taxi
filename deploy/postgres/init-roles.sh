#!/bin/sh
# Runs once, on the first start of an empty data volume (docker-entrypoint-initdb.d).
# Production twin of infra/postgres/init/01-roles.sql, with the password from the environment.
# taxi_owner (POSTGRES_USER) owns the schema and runs migrations; taxi_app is the API/worker
# runtime role: not a superuser and not a table owner, so it cannot alter the schema.
# Changing POSTGRES_APP_PASSWORD later does not re-run this: see docs/runbook.md (rotating secrets).
set -eu
: "${TAXI_APP_PASSWORD:?TAXI_APP_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pw="$TAXI_APP_PASSWORD" <<'SQL'
CREATE ROLE taxi_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
-- the runtime role never needs more than a pool's worth of connections per process
ALTER ROLE taxi_app CONNECTION LIMIT 80;
SQL
