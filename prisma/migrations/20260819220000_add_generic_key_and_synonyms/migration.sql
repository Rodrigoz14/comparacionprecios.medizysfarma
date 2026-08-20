-- AlterTable
ALTER TABLE "products" ADD COLUMN     "generic_key" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ingredient_synonyms" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "canonical_term" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_synonyms_term_key" ON "ingredient_synonyms"("term");

-- CreateIndex
CREATE INDEX "ingredient_synonyms_canonical_term_idx" ON "ingredient_synonyms"("canonical_term");

-- CreateIndex
CREATE INDEX "products_generic_key_idx" ON "products"("generic_key");
