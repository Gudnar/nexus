-- CreateEnum
CREATE TYPE "ScheduleExceptionType" AS ENUM ('BLOCK', 'ALLOW');

-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "schedule_id" UUID;

-- CreateTable
CREATE TABLE "user_schedule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "schedule_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exception" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "ScheduleExceptionType" NOT NULL,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "reason" TEXT,

    CONSTRAINT "schedule_exception_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_schedule_tenant_id_id_key" ON "user_schedule"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_schedule_tenant_id_name_key" ON "user_schedule"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "schedule_rule_schedule_id_idx" ON "schedule_rule"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_rule_tenant_id_id_key" ON "schedule_rule"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "schedule_exception_schedule_id_date_idx" ON "schedule_exception"("schedule_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_exception_tenant_id_id_key" ON "schedule_exception"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "user_schedule"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_schedule" ADD CONSTRAINT "user_schedule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_rule" ADD CONSTRAINT "schedule_rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_rule" ADD CONSTRAINT "schedule_rule_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "user_schedule"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "user_schedule"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integridad de las ventanas y excepciones ─────────────────────────
ALTER TABLE schedule_rule ADD CONSTRAINT schedule_rule_weekday CHECK (weekday BETWEEN 1 AND 7);
ALTER TABLE schedule_rule ADD CONSTRAINT schedule_rule_minutes
  CHECK (start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND end_minute <> start_minute);
ALTER TABLE schedule_exception ADD CONSTRAINT schedule_exception_minutes CHECK (
  (start_minute IS NULL AND end_minute IS NULL)
  OR (start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute)
);

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_schedule', 'schedule_rule', 'schedule_exception'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_schedule, schedule_rule, schedule_exception TO erp_app;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_schedule, schedule_rule, schedule_exception TO erp_platform;
  END IF;
END $$;
