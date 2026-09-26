#!/bin/sh
# Deploys the images named in deploy/.env.prod (TAXI_API_IMAGE, TAXI_WEB_IMAGE) with no API
# downtime. Change the tags in .env.prod, then:
#   deploy/update.sh
# Rollback = put the previous tags back and run it again (only while the database schema is
# still compatible with the old code: migrations are forward-only, docs/deploy.md).
#
# 1. pull the images
# 2. run pending migrations (one-shot; a failure stops here, the running version stays up)
# 3. API: start as many new instances as are running, wait until they are healthy, then stop
#    the old ones (Caddy finds instances by DNS and retries a failed connection elsewhere)
# 4. worker and web panel: recreate (the worker catches up from the outbox; seconds)
# 5. reload Caddy in case the Caddyfile changed
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="$DIR/compose.sh"
ENV_FILE="${TAXI_ENV_FILE:-$DIR/.env.prod}"
REPLICAS="$(sed -n 's/^API_REPLICAS=//p' "$ENV_FILE" | tail -n 1)"
REPLICAS="${REPLICAS:-1}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

log() { echo "$(date -u +%FT%TZ) $*"; }

log "pulling images"
"$COMPOSE" pull --quiet --ignore-pull-failures api worker web migrate caddy

log "running migrations"
"$COMPOSE" run --rm migrate

OLD="$("$COMPOSE" ps -q api)"
RUNNING="$(printf '%s\n' "$OLD" | grep -c . || true)"
if [ "$RUNNING" -eq 0 ]; then
  log "API not running: starting everything"
  "$COMPOSE" up -d
  exit 0
fi

log "starting $RUNNING new API instance(s) next to the old ones"
"$COMPOSE" up -d --no-deps --no-recreate --scale api="$((RUNNING * 2))" api
OLD_LIST=" $(printf '%s\n' "$OLD" | tr '\n' ' ') "
NEW=""
for id in $("$COMPOSE" ps -q api); do
  case "$OLD_LIST" in
    *" $id "*) ;;
    *) NEW="$NEW $id" ;;
  esac
done
[ -n "$NEW" ] || { log "no new API instances were created"; exit 1; }

log "waiting for the new instances to be healthy"
waited=0
for id in $NEW; do
  while :; do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id")"
    [ "$status" = healthy ] && break
    if [ "$status" = unhealthy ] || [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      log "new instance $id is $status: removing the new ones, the old version keeps serving"
      # shellcheck disable=SC2086
      docker rm -f $NEW > /dev/null
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
done

# let Caddy's DNS refresh (5 s) pick the new instances up before the old ones go
sleep 6
log "stopping the old API instances"
# shellcheck disable=SC2086
docker stop -t 30 $OLD > /dev/null
# shellcheck disable=SC2086
docker rm $OLD > /dev/null
"$COMPOSE" up -d --no-deps --no-recreate --scale api="$REPLICAS" api

log "updating worker and web panel"
"$COMPOSE" up -d --no-deps worker web

log "reloading Caddy"
"$COMPOSE" exec -T caddy caddy reload --config /etc/caddy/Caddyfile > /dev/null 2>&1 \
  || "$COMPOSE" up -d --no-deps caddy

"$COMPOSE" ps
log "deployed $(sed -n 's/^TAXI_API_IMAGE=//p' "$ENV_FILE" | tail -n 1)"
