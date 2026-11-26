-- Ejecutar como spike_migrator DESPUÉS del DDL generado por Prisma.
-- Implementa ADR-001: RLS forzado, tenant_id inmutable y grants mínimos.

-- ── tenant_id inmutable ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_tenant_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id es inmutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── RLS + trigger en cada tabla tenant-scoped ────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branch', 'customer', 'warehouse', 'sale', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
    EXECUTE format($p$
      CREATE TRIGGER %I BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change()
    $p$, t || '_tenant_immutable', t);
  END LOOP;
END $$;

-- ── Grants mínimos para el rol de aplicación ─────────────────────────
GRANT SELECT ON tenant TO spike_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON branch, customer, warehouse, sale TO spike_app;
GRANT SELECT, INSERT ON audit_log TO spike_app;  -- append-only
