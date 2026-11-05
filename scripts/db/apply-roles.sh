#!/usr/bin/env bash
# apply-roles.sh: Re-apply role definitions to an already-running postgres container.
# Use this when the postgres volume already exists and you need to recreate or update roles.
#
# Requires: POSTGRES_OWNER_PASSWORD and POSTGRES_APP_PASSWORD in the environment.
set -euo pipefail

: "${POSTGRES_OWNER_PASSWORD:?POSTGRES_OWNER_PASSWORD is required}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}"

PSQL_CMD="docker compose exec -T postgres psql -U postgres"

echo "Applying roles.sql..."
$PSQL_CMD \
  -v owner_password="$POSTGRES_OWNER_PASSWORD" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  -f /docker/postgres/roles.sql

echo "Applying db-setup.sql to findmyjob..."
$PSQL_CMD -d findmyjob -f /docker/postgres/db-setup.sql

echo "Applying db-setup.sql to findmyjob_test..."
$PSQL_CMD -d findmyjob_test -f /docker/postgres/db-setup.sql 2>/dev/null || \
  echo "  findmyjob_test does not exist yet, skipping"

echo "Applying db-setup.sql to findmyjob_shadow..."
$PSQL_CMD -d findmyjob_shadow -f /docker/postgres/db-setup.sql 2>/dev/null || \
  echo "  findmyjob_shadow does not exist yet, skipping"

echo "Done."
