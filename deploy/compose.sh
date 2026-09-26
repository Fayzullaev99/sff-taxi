#!/bin/sh
# docker compose with the production file and env file, from any directory:
#   deploy/compose.sh up -d
#   deploy/compose.sh logs -f --tail=100 api worker
#   deploy/compose.sh ps
# TAXI_ENV_FILE picks another env file (default deploy/.env.prod), e.g. for a local rehearsal.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${TAXI_ENV_FILE:-.env.prod}"
case "$ENV_FILE" in
  /* | [A-Za-z]:*) ENV_PATH="$ENV_FILE" ;;
  *) ENV_PATH="$DIR/$ENV_FILE" ;;
esac
[ -f "$ENV_PATH" ] || { echo "missing $ENV_PATH (copy deploy/.env.prod.example)" >&2; exit 1; }
export TAXI_ENV_FILE="$ENV_PATH"
exec docker compose -f "$DIR/docker-compose.prod.yml" --env-file "$ENV_PATH" "$@"
