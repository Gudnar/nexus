-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('PRODUCTS', 'PRICES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "price_list_id" UUID,
    "totals" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "result" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_job_tenant_id_created_at_idx" ON "import_job"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_tenant_id_id_key" ON "import_job"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_tenant_id_price_list_id_fkey" FOREIGN KEY ("tenant_id", "price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
ALTER TABLE import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_job
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE TRIGGER import_job_tenant_immutable BEFORE UPDATE ON import_job
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change();

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['erp_app', 'erp_platform'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON import_job TO %I', r);
      -- Las importaciones no se borran: quedan como trazabilidad.
      EXECUTE format('REVOKE DELETE, TRUNCATE ON import_job FROM %I', r);
    END IF;
  END LOOP;
END $$;
