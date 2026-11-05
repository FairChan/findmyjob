#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="/docker/postgres"

# Create roles (passwords injected from docker-compose environment)
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  -v owner_password="$POSTGRES_OWNER_PASSWORD" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  -f "$SCRIPTS_DIR/roles.sql"

# Set up the main database
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname findmyjob \
  -f "$SCRIPTS_DIR/db-setup.sql"

# Install pg_stat_statements in the postgres admin database
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

# Create test and shadow databases
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
  CREATE DATABASE findmyjob_test OWNER findmyjob_owner;
  CREATE DATABASE findmyjob_shadow OWNER findmyjob_owner;
SQL

# Set up test and shadow databases
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname findmyjob_test \
  -f "$SCRIPTS_DIR/db-setup.sql"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname findmyjob_shadow \
  -f "$SCRIPTS_DIR/db-setup.sql"
