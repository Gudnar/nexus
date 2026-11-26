-- RLS, inmutabilidad de tenant_id, índices parciales y grants (ADR-001, ADR-006).
-- Se aplica con el rol propietario (`erp_owner`) mediante `prisma migrate deploy`.
-- Al añadir una tabla con tenant_id, debe agregarse a la lista de abajo; la prueba de
-- catálogo (tests/catalog.test.ts) falla si se olvida.

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
  FOREACH t IN ARRAY ARRAY[
    'branch', 'membership', 'role', 'role_permission', 'user_role', 'user_branch_access',
    'audit_log', 'outbox_event', 'idempotency_record', 'sequence', 'tenant_setting'
  ] LOOP
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

-- ── Membresías: un usuario puede leer SUS membresías sin conocer aún el tenant ──
-- (resolución de login: app.user_id fijado por withUserContext). Solo lectura.
CREATE POLICY user_self_read ON membership FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ── Índices parciales ────────────────────────────────────────────────
-- Una sola sucursal principal por tenant.
CREATE UNIQUE INDEX branch_one_main_per_tenant ON branch (tenant_id) WHERE is_main;
-- Secuencias: NULL no cuenta como igual en un UNIQUE normal, se separan en dos índices.
CREATE UNIQUE INDEX sequence_tenant_doc ON sequence (tenant_id, document_type)
  WHERE branch_id IS NULL;
CREATE UNIQUE INDEX sequence_branch_doc ON sequence (tenant_id, branch_id, document_type)
  WHERE branch_id IS NOT NULL;

-- ── Grants del rol de aplicación ─────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    -- Tablas globales de plataforma: solo lectura (o nada) para la aplicación.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON plan, tenant, permission FROM erp_app;
    REVOKE ALL ON platform_user FROM erp_app;
    -- Auditoría append-only.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM erp_app;
  END IF;
END $$;
