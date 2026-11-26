-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "all_branches" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_branch" (
    "tenant_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "access_level" "BranchAccessLevel" NOT NULL DEFAULT 'OPERATE',

    CONSTRAINT "invitation_branch_pkey" PRIMARY KEY ("tenant_id","invitation_id","branch_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_tenant_id_email_idx" ON "invitation"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tenant_id_id_key" ON "invitation"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_branch" ADD CONSTRAINT "invitation_branch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_branch" ADD CONSTRAINT "invitation_branch_tenant_id_invitation_id_fkey" FOREIGN KEY ("tenant_id", "invitation_id") REFERENCES "invitation"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_branch" ADD CONSTRAINT "invitation_branch_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── RLS, inmutabilidad de tenant_id y grants (mismo patrón que la migración de RLS) ──
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invitation', 'invitation_branch'] LOOP
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
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON invitation, invitation_branch TO erp_app;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON invitation, invitation_branch TO erp_platform;
  END IF;
END $$;
