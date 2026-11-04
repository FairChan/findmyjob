-- roles.sql: Create or update database roles (idempotent)
-- Usage: psql -v owner_password='...' -v app_password='...' -f roles.sql

-- Create roles if they do not exist yet
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'findmyjob_owner') THEN
    CREATE ROLE findmyjob_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'findmyjob_app') THEN
    CREATE ROLE findmyjob_app;
  END IF;
END; $$;

-- findmyjob_owner: migrations and test cleanup; CREATEDB for local dev
ALTER ROLE findmyjob_owner WITH LOGIN PASSWORD :'owner_password' CREATEDB;
ALTER ROLE findmyjob_owner SET lock_timeout = '5s';
ALTER ROLE findmyjob_owner SET statement_timeout = '10min';

-- findmyjob_app: app and worker connections
ALTER ROLE findmyjob_app WITH LOGIN PASSWORD :'app_password';
ALTER ROLE findmyjob_app SET statement_timeout = '30s';
ALTER ROLE findmyjob_app SET idle_in_transaction_session_timeout = '30s';
