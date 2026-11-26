-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "billing_name" TEXT,
ADD COLUMN     "billing_tax_id" TEXT,
ADD COLUMN     "with_tax" BOOLEAN NOT NULL DEFAULT true;

