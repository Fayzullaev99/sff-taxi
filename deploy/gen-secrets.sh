#!/bin/sh
# Prints fresh values for every secret in .env.prod. Paste them over the empty lines:
#   deploy/gen-secrets.sh
# Run once per installation. Rotating an existing secret: docs/runbook.md ("Rotating secrets").
set -eu
command -v openssl > /dev/null || { echo "openssl is required" >&2; exit 1; }
cat <<EOF
POSTGRES_OWNER_PASSWORD=$(openssl rand -hex 32)
POSTGRES_APP_PASSWORD=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
STORAGE_S3_ACCESS_KEY=$(openssl rand -hex 16)
STORAGE_S3_SECRET_KEY=$(openssl rand -hex 32)
METRICS_TOKEN=$(openssl rand -hex 24)
GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
