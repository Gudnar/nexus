-- AlterTable
ALTER TABLE "supplier" ADD COLUMN "contact_role" TEXT;

-- CreateTable
CREATE TABLE "supplier_bank_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_type" TEXT NOT NULL DEFAULT 'CHECKING',
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "holder_name" TEXT NOT NULL,
    "holder_tax_id" TEXT,
    "notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bank_account_tenant_id_id_key" ON "supplier_bank_account"("tenant_id", "id");
CREATE INDEX "supplier_bank_account_tenant_id_supplier_id_idx" ON "supplier_bank_account"("tenant_id", "supplier_id");
CREATE UNIQUE INDEX "supplier_history_tenant_id_id_key" ON "supplier_history"("tenant_id", "id");
CREATE INDEX "supplier_history_tenant_id_supplier_id_created_at_idx" ON "supplier_history"("tenant_id", "supplier_id", "created_at");

-- AddForeignKey
ALTER TABLE "supplier_bank_account" ADD CONSTRAINT "supplier_bank_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bank_account" ADD CONSTRAINT "supplier_bank_account_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_history" ADD CONSTRAINT "supplier_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_history" ADD CONSTRAINT "supplier_history_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integridad ───────────────────────────────────────────────────────
ALTER TABLE supplier_bank_account ADD CONSTRAINT supplier_bank_account_type CHECK (account_type IN ('CHECKING', 'SAVINGS'));
ALTER TABLE supplier_bank_account ADD CONSTRAINT supplier_bank_account_currency CHECK (currency IN ('BOB', 'USD'));
-- Una sola cuenta principal activa por proveedor.
CREATE UNIQUE INDEX supplier_bank_account_default ON supplier_bank_account (tenant_id, supplier_id) WHERE is_default AND status = 'ACTIVE';

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_bank_account', 'supplier_history'] LOOP
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

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['erp_app', 'erp_platform'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON supplier_bank_account TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON supplier_bank_account FROM %I', r);
      -- El historial no se corrige ni se borra.
      EXECUTE format('GRANT SELECT, INSERT ON supplier_history TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON supplier_history FROM %I', r);
    END IF;
  END LOOP;
END $$;
