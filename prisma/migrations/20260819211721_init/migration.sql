-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COMPRAS', 'CONSULTA');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'PARTIAL', 'OUT_OF_STOCK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'ERROR');

-- CreateEnum
CREATE TYPE "CustomerRequestStatus" AS ENUM ('RECEIVED', 'ANALYZING', 'REVIEW_REQUIRED', 'READY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCH', 'REVIEW', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('BORRADOR', 'EN_REVISION', 'APROBADA', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('BORRADOR', 'APROBADA', 'ENVIADA', 'RECIBIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CONSULTA',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_access_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_value" JSONB,
    "after_value" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "internal_code" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "commercial_terms" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laboratories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "laboratories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "internal_code" TEXT,
    "standard_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "active_ingredient" TEXT NOT NULL,
    "concentration" TEXT NOT NULL,
    "concentration_unit" TEXT NOT NULL,
    "dosage_form" TEXT NOT NULL,
    "presentation_type" TEXT NOT NULL,
    "presentation_quantity" INTEGER NOT NULL,
    "presentation_unit" TEXT NOT NULL,
    "presentation_description" TEXT,
    "laboratory_id" TEXT,
    "barcode" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_offers" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "supplier_product_code" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "tax" DECIMAL(14,2),
    "final_price" DECIMAL(14,2),
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "stock_quantity" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_file_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offer_expires_at" TIMESTAMP(3),

    CONSTRAINT "supplier_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "supplier_offer_id" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "source_file_id" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_files" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_email_id" TEXT,
    "original_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'RECEIVED',
    "total_rows" INTEGER,
    "success_rows" INTEGER,
    "error_rows" INTEGER,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "supplier_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_emails" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "subject" TEXT,
    "external_message_id" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'RECEIVED',
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "supplier_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_requests" (
    "id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "responsible_user_id" TEXT,
    "status" "CustomerRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "original_file_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_request_items" (
    "id" TEXT NOT NULL,
    "customer_request_id" TEXT NOT NULL,
    "original_text" TEXT NOT NULL,
    "matched_product_id" TEXT,
    "requested_quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "match_status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "match_confidence" DECIMAL(5,4),

    CONSTRAINT "customer_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_comparisons" (
    "id" TEXT NOT NULL,
    "customer_request_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_offer_id" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "availability" "Availability" NOT NULL,
    "match_confidence" DECIMAL(5,4) NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "discard_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "quotation_number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_request_id" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'BORRADOR',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchase_price" DECIMAL(14,2) NOT NULL,
    "sale_price" DECIMAL(14,2) NOT NULL,
    "margin" DECIMAL(5,4) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "selected_supplier_id" TEXT NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'BORRADOR',
    "total" DECIMAL(14,2) NOT NULL,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "supplier_product_code" TEXT,
    "notes" TEXT,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "laboratories_normalized_name_key" ON "laboratories"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "products_internal_code_key" ON "products"("internal_code");

-- CreateIndex
CREATE UNIQUE INDEX "products_normalized_name_key" ON "products"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_active_ingredient_concentration_dosage_form_idx" ON "products"("active_ingredient", "concentration", "dosage_form");

-- CreateIndex
CREATE INDEX "products_laboratory_id_idx" ON "products"("laboratory_id");

-- CreateIndex
CREATE INDEX "supplier_offers_product_id_idx" ON "supplier_offers"("product_id");

-- CreateIndex
CREATE INDEX "supplier_offers_availability_idx" ON "supplier_offers"("availability");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_offers_supplier_id_product_id_key" ON "supplier_offers"("supplier_id", "product_id");

-- CreateIndex
CREATE INDEX "price_history_supplier_offer_id_recorded_at_idx" ON "price_history"("supplier_offer_id", "recorded_at");

-- CreateIndex
CREATE INDEX "supplier_files_supplier_id_idx" ON "supplier_files"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_files_supplier_id_file_hash_key" ON "supplier_files"("supplier_id", "file_hash");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_emails_external_message_id_key" ON "supplier_emails"("external_message_id");

-- CreateIndex
CREATE INDEX "supplier_emails_supplier_id_idx" ON "supplier_emails"("supplier_id");

-- CreateIndex
CREATE INDEX "customer_requests_responsible_user_id_idx" ON "customer_requests"("responsible_user_id");

-- CreateIndex
CREATE INDEX "customer_request_items_customer_request_id_idx" ON "customer_request_items"("customer_request_id");

-- CreateIndex
CREATE INDEX "customer_request_items_matched_product_id_idx" ON "customer_request_items"("matched_product_id");

-- CreateIndex
CREATE INDEX "price_comparisons_customer_request_item_id_idx" ON "price_comparisons"("customer_request_item_id");

-- CreateIndex
CREATE INDEX "price_comparisons_product_id_idx" ON "price_comparisons"("product_id");

-- CreateIndex
CREATE INDEX "price_comparisons_supplier_id_idx" ON "price_comparisons"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotation_number_key" ON "quotations"("quotation_number");

-- CreateIndex
CREATE INDEX "quotations_customer_request_id_idx" ON "quotations"("customer_request_id");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "quotation_items_quotation_id_idx" ON "quotation_items"("quotation_id");

-- CreateIndex
CREATE INDEX "quotation_items_product_id_idx" ON "quotation_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_order_number_key" ON "purchase_orders"("order_number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_quotation_id_idx" ON "purchase_orders"("quotation_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_product_id_idx" ON "purchase_order_items"("product_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_laboratory_id_fkey" FOREIGN KEY ("laboratory_id") REFERENCES "laboratories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "supplier_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_supplier_offer_id_fkey" FOREIGN KEY ("supplier_offer_id") REFERENCES "supplier_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "supplier_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_files" ADD CONSTRAINT "supplier_files_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_files" ADD CONSTRAINT "supplier_files_supplier_email_id_fkey" FOREIGN KEY ("supplier_email_id") REFERENCES "supplier_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_emails" ADD CONSTRAINT "supplier_emails_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_items" ADD CONSTRAINT "customer_request_items_customer_request_id_fkey" FOREIGN KEY ("customer_request_id") REFERENCES "customer_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_items" ADD CONSTRAINT "customer_request_items_matched_product_id_fkey" FOREIGN KEY ("matched_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_comparisons" ADD CONSTRAINT "price_comparisons_customer_request_item_id_fkey" FOREIGN KEY ("customer_request_item_id") REFERENCES "customer_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_comparisons" ADD CONSTRAINT "price_comparisons_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_comparisons" ADD CONSTRAINT "price_comparisons_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_comparisons" ADD CONSTRAINT "price_comparisons_supplier_offer_id_fkey" FOREIGN KEY ("supplier_offer_id") REFERENCES "supplier_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_request_id_fkey" FOREIGN KEY ("customer_request_id") REFERENCES "customer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
