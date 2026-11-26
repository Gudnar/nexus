-- AlterTable
ALTER TABLE "product" ADD COLUMN     "group_id" UUID,
ADD COLUMN     "variant_key" TEXT,
ADD COLUMN     "variant_values" JSONB;

-- CreateTable
CREATE TABLE "product_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "options" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_integration" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_enc" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_group_tenant_id_id_key" ON "product_group"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "product_image_tenant_id_product_id_idx" ON "product_image"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_tenant_id_id_key" ON "product_image"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_tenant_id_public_id_key" ON "product_image"("tenant_id", "public_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_integration_tenant_id_id_key" ON "tenant_integration"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_integration_tenant_id_provider_key" ON "tenant_integration"("tenant_id", "provider");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "product_group"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_group" ADD CONSTRAINT "product_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_integration" ADD CONSTRAINT "tenant_integration_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Una combinación de valores no se repite dentro de su familia.
CREATE UNIQUE INDEX product_variant_unique ON product (tenant_id, group_id, variant_key) WHERE group_id IS NOT NULL;
ALTER TABLE product ADD CONSTRAINT product_variant_consistent CHECK ((group_id IS NULL) = (variant_key IS NULL));
-- Una sola foto principal por producto.
CREATE UNIQUE INDEX product_image_primary ON product_image (tenant_id, product_id) WHERE is_primary;
ALTER TABLE tenant_integration ADD CONSTRAINT tenant_integration_provider CHECK (provider ~ '^[A-Z][A-Z0-9_]{2,30}$');

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_group', 'product_image', 'tenant_integration'] LOOP
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
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON product_group, tenant_integration TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON product_group, tenant_integration FROM %I', r);
      -- Las fotos sí se pueden quitar.
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON product_image TO %I', r);
      EXECUTE format('REVOKE TRUNCATE ON product_image FROM %I', r);
    END IF;
  END LOOP;
END $$;
