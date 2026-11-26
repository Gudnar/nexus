-- AlterTable
ALTER TABLE "printer_device" ADD COLUMN     "cash_register_id" UUID,
ADD COLUMN     "chars_per_line" INTEGER NOT NULL DEFAULT 42,
ADD COLUMN     "codepage" TEXT NOT NULL DEFAULT 'CP858',
ADD COLUMN     "connection" TEXT NOT NULL DEFAULT 'BROWSER',
ADD COLUMN     "cut_mode" TEXT NOT NULL DEFAULT 'FULL',
ADD COLUMN     "feed_lines" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "host" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'HTML',
ADD COLUMN     "open_drawer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "port" INTEGER;

-- AddForeignKey
ALTER TABLE "printer_device" ADD CONSTRAINT "printer_device_tenant_id_cash_register_id_fkey" FOREIGN KEY ("tenant_id", "cash_register_id") REFERENCES "cash_register"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE printer_device ADD CONSTRAINT printer_device_connection CHECK (connection IN ('BROWSER', 'NETWORK', 'USB', 'SERIAL', 'SYSTEM'));
ALTER TABLE printer_device ADD CONSTRAINT printer_device_mode CHECK (mode IN ('HTML', 'TEXT'));
ALTER TABLE printer_device ADD CONSTRAINT printer_device_codepage CHECK (codepage IN ('CP437', 'CP850', 'CP858', 'WPC1252', 'UTF8'));
ALTER TABLE printer_device ADD CONSTRAINT printer_device_cut CHECK (cut_mode IN ('NONE', 'PARTIAL', 'FULL'));
ALTER TABLE printer_device ADD CONSTRAINT printer_device_cols CHECK (chars_per_line BETWEEN 24 AND 96 AND feed_lines BETWEEN 0 AND 12);
-- Por red hacen falta dirección y puerto válidos.
ALTER TABLE printer_device ADD CONSTRAINT printer_device_network CHECK (connection <> 'NETWORK' OR (host IS NOT NULL AND port BETWEEN 1 AND 65535));
-- Una sola predeterminada por caja.
CREATE UNIQUE INDEX printer_device_cash_default ON printer_device (tenant_id, cash_register_id) WHERE is_default AND active AND cash_register_id IS NOT NULL;
