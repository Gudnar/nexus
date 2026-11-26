-- Ejecutar como superusuario: psql -U postgres -h localhost -f infra/setup-db.sql
-- Crea la base `erp`, el rol propietario (migraciones) y el rol de aplicacion (sin BYPASSRLS).

CREATE ROLE erp_owner LOGIN PASSWORD 'erp_owner_pass' NOSUPERUSER;
CREATE ROLE erp_app   LOGIN PASSWORD 'erp_app_pass'   NOSUPERUSER NOBYPASSRLS;
CREATE ROLE erp_platform LOGIN PASSWORD 'erp_platform_pass' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE erp_worker LOGIN PASSWORD 'erp_worker_pass' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE erp OWNER erp_owner;

\connect erp
GRANT CONNECT ON DATABASE erp TO erp_app, erp_platform, erp_worker;
GRANT USAGE ON SCHEMA public TO erp_app, erp_platform, erp_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
-- Rol de plataforma (ADR-001): también sujeto a RLS; escribe en tablas globales (tenant, plan, ajustes).
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_platform;
