-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFY');

-- CreateEnum
CREATE TYPE "RecoveryChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_pending_secret" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_verified_at" TIMESTAMP(3),
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "platform_user" ADD COLUMN     "failed_logins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mfa_recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "channel" "RecoveryChannel" NOT NULL DEFAULT 'EMAIL',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_request" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "company_name" TEXT NOT NULL,
    "tax_id" TEXT,
    "admin_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_token_token_hash_key" ON "one_time_token"("token_hash");

-- CreateIndex
CREATE INDEX "one_time_token_user_id_purpose_created_at_idx" ON "one_time_token"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "registration_request_token_hash_key" ON "registration_request"("token_hash");

-- CreateIndex
CREATE INDEX "registration_request_email_idx" ON "registration_request"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- AddForeignKey
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Reglas de integridad que Prisma no expresa ───────────────────────
-- Identificadores de acceso normalizados: el correo en minúsculas y el username sin "@"
-- (así "usuario o correo" siempre se distingue por la presencia de "@").
ALTER TABLE app_user ADD CONSTRAINT app_user_email_lower CHECK (email = lower(email));
ALTER TABLE app_user ADD CONSTRAINT app_user_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

-- ── Grants ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    -- La solicitud de registro guarda un hash de contraseña: solo el rol de plataforma.
    REVOKE ALL ON registration_request FROM erp_app;
    -- La aplicación puede LEER los ajustes globales (p. ej. registro habilitado) pero no cambiarlos.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_setting FROM erp_app;
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_platform') THEN
    -- Tablas existentes (las futuras las cubre ALTER DEFAULT PRIVILEGES de infra/setup-db.sql).
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_platform;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_platform;
    -- La auditoría es append-only también para la plataforma.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM erp_platform;
  END IF;
END $$;
