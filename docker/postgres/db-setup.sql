-- db-setup.sql: Grant findmyjob_app access to the current database (idempotent)
-- Run as postgres superuser while connected to the target database.

-- Transfer database ownership to findmyjob_owner and grant CONNECT to findmyjob_app
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO findmyjob_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO findmyjob_app', current_database());
END; $$;

-- Schema access
GRANT USAGE ON SCHEMA public TO findmyjob_app;

-- Default privileges: SELECT, INSERT, UPDATE, DELETE on tables (no TRUNCATE)
ALTER DEFAULT PRIVILEGES FOR ROLE findmyjob_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO findmyjob_app;

-- Default privileges: USAGE, SELECT on sequences
ALTER DEFAULT PRIVILEGES FOR ROLE findmyjob_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO findmyjob_app;

-- pgboss schema owned by findmyjob_app (pg-boss task queue)
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION findmyjob_app;
