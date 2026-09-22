-- AlterTable
ALTER TABLE "supplier_offers" ADD COLUMN     "expiration_date" TIMESTAMP(3),
ADD COLUMN     "unit_price_as_imported" DECIMAL(14,4);
