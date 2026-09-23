-- AlterTable
ALTER TABLE "supplier_offers" DROP COLUMN "expiration_date",
ADD COLUMN     "expiration_label" TEXT;
