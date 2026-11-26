-- Base DESCARTABLE para las pruebas automáticas: las pruebas de la API la vacían (TRUNCATE) en cada ejecución.
-- Así los datos de la base de trabajo `erp` (los que se cargan a mano para probar la web) nunca se pierden.
-- Requiere que ya existan los roles (infra/setup-db.sql). Ejecutar como superusuario:
--   psql -U postgres -h localhost -f infra/setup-test-db.sql
-- Luego aplicar migraciones con DIRECT_URL apuntando a erp_test (ver README).

CREATE DATABASE erp_test OWNER erp_owner;

\connect erp_test
GRANT CONNECT ON DATABASE erp_test TO erp_app, erp_platform, erp_worker;
GRANT USAGE ON SCHEMA public TO erp_app, erp_platform, erp_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_platform;
