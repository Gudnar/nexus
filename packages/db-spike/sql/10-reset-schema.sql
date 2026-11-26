-- Ejecutar como superusuario conectado a erp_spike. Recrea el schema desde cero.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION spike_migrator;
GRANT USAGE ON SCHEMA public TO spike_app;
