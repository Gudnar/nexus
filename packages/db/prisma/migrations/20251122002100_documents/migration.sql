-- CreateTable
CREATE TABLE "document_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_device" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paper" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_template_tenant_id_id_key" ON "document_template"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_tenant_id_doc_type_key" ON "document_template"("tenant_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_version_tenant_id_id_key" ON "document_template_version"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_version_tenant_id_template_id_version_key" ON "document_template_version"("tenant_id", "template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "printer_device_tenant_id_id_key" ON "printer_device"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "printer_device_tenant_id_name_key" ON "printer_device"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_version" ADD CONSTRAINT "document_template_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_version" ADD CONSTRAINT "document_template_version_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "document_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_device" ADD CONSTRAINT "printer_device_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_device" ADD CONSTRAINT "printer_device_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE document_template ADD CONSTRAINT document_template_type CHECK (doc_type ~ '^[A-Z][A-Z0-9_]{2,40}$');
ALTER TABLE printer_device ADD CONSTRAINT printer_device_kind CHECK (kind IN ('BROWSER', 'THERMAL', 'LASER', 'OTHER'));
-- Una sola impresora predeterminada por sucursal (y una general sin sucursal).
CREATE UNIQUE INDEX printer_device_default ON printer_device (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_default AND active;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_template', 'document_template_version', 'printer_device'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change()', t || '_tenant_immutable', t);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['erp_app', 'erp_platform'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON document_template, printer_device TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON document_template, printer_device FROM %I', r);
      EXECUTE format('GRANT SELECT, INSERT ON document_template_version TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON document_template_version FROM %I', r);
    END IF;
  END LOOP;
END $$;
