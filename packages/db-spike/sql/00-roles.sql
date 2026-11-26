-- Ejecutar como superusuario (lo hace scripts/setup.ts). Idempotente.
-- Base y roles EXCLUSIVOS del spike; no tocan la base `erp` ni sus roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spike_migrator') THEN
    CREATE ROLE spike_migrator LOGIN PASSWORD 'spike_migrator_pass' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spike_app') THEN
    CREATE ROLE spike_app LOGIN PASSWORD 'spike_app_pass' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

SELECT 'CREATE DATABASE erp_spike OWNER spike_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'erp_spike')\gexec
