-- El historial de precios es append-only. Los privilegios por defecto (infra/setup-db.sql) conceden
-- CRUD completo a cada tabla nueva, y un GRANT no quita permisos: hay que REVOCAR explícitamente.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['erp_app', 'erp_platform'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON price_history FROM %I', r);
    END IF;
  END LOOP;
END $$;
