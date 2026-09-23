-- DropIndex
DROP INDEX "supplier_offers_supplier_id_product_id_key";

-- CreateIndex
CREATE INDEX "supplier_offers_supplier_id_product_id_idx" ON "supplier_offers"("supplier_id", "product_id");
