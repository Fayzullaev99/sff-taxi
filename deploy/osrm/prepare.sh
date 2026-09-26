#!/bin/sh
# Builds (or refreshes) the OSRM road graph for Uzbekistan from the Geofabrik extract:
#   deploy/osrm/prepare.sh            # car profile (scooters and cars in town)
#   OSRM_PROFILE=bicycle deploy/osrm/prepare.sh
# Then set COMPOSE_PROFILES=...,osrm, ROUTER=osrm and OSRM_URL=http://osrm:5000 in .env.prod.
#
# The new graph is built in a fresh folder while the running router keeps serving the old
# one; only a finished build replaces deploy/osrm/data/current, then the router restarts
# (a few seconds; the API falls back to straight-line distances meanwhile). Geofabrik updates
# daily; refreshing monthly is plenty (docs/runbook.md). Needs ~2 GB RAM and ~2 GB disk.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="$DIR/data"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v5.27.1}"
PROFILE="${OSRM_PROFILE:-car}"
URL="${OSRM_PBF_URL:-https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf}"
NAME=uzbekistan-latest
BUILD="$DATA/build-$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BUILD"
echo "downloading $URL"
curl -fL --retry 3 -o "$BUILD/$NAME.osm.pbf" "$URL"
if curl -fsL --retry 3 -o "$BUILD/$NAME.osm.pbf.md5" "$URL.md5"; then
  (cd "$BUILD" && md5sum -c "$NAME.osm.pbf.md5") || { echo "checksum mismatch" >&2; exit 1; }
else
  echo "warning: no checksum published, not verified"
fi

run() { docker run --rm -t -v "$BUILD:/data" "$IMAGE" "$@"; }
run osrm-extract -p "/opt/$PROFILE.lua" "/data/$NAME.osm.pbf"
run osrm-partition "/data/$NAME.osrm"
run osrm-customize "/data/$NAME.osrm"
rm -f "$BUILD/$NAME.osm.pbf" "$BUILD/$NAME.osm.pbf.md5"

# swap: current -> previous (kept for a quick rollback), build -> current
rm -rf "$DATA/previous"
[ -d "$DATA/current" ] && mv "$DATA/current" "$DATA/previous"
mv "$BUILD" "$DATA/current"
echo "graph ready in $DATA/current"

if "$DIR/../compose.sh" ps --services --status running 2>/dev/null | grep -qx osrm; then
  "$DIR/../compose.sh" restart osrm
  echo "osrm restarted with the new graph"
fi
