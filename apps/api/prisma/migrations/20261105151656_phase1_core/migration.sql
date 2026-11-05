-- CreateEnum
CREATE TYPE "StockUnit" AS ENUM ('g', 'ml', 'ea');

-- CreateEnum
CREATE TYPE "NutritionSource" AS ENUM ('label', 'manual_estimate', 'ai_estimate');

-- CreateEnum
CREATE TYPE "SnapshotNutritionSource" AS ENUM ('label', 'manual_estimate', 'ai_estimate', 'backfill');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ordered', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('receipt', 'initial', 'consume', 'consume_reverse', 'adjust', 'waste', 'other_use');

-- CreateEnum
CREATE TYPE "MealSlot" AS ENUM ('breakfast', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack', 'extra');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('template', 'outside', 'none');

-- CreateEnum
CREATE TYPE "MealStatus" AS ENUM ('unrecorded', 'eaten', 'skipped');

-- CreateEnum
CREATE TYPE "MealKind" AS ENUM ('home', 'outside');

-- CreateTable
CREATE TABLE "goal_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "target_weight_kg" DECIMAL(6,2) NOT NULL,
    "daily_kcal" INTEGER NOT NULL,
    "protein_g" DECIMAL(8,2) NOT NULL,
    "carb_g" DECIMAL(8,2),
    "fat_g" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "stock_unit" "StockUnit" NOT NULL,
    "unit_label" TEXT,
    "units_per_package" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "pack_weight_g" DECIMAL(12,3),
    "is_stock_tracked" BOOLEAN NOT NULL DEFAULT true,
    "default_serving_amount" DECIMAL(12,3),
    "purchase_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_nutrition_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "basis_amount" DECIMAL(12,3) NOT NULL,
    "basis_unit" "StockUnit" NOT NULL,
    "kcal" DECIMAL(12,3),
    "carb_g" DECIMAL(12,3),
    "protein_g" DECIMAL(12,3),
    "fat_g" DECIMAL(12,3),
    "source" "NutritionSource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_nutrition_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "purchased_on" DATE NOT NULL,
    "price" DECIMAL(12,2),
    "url" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ordered',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "purchase_id" UUID,
    "quantity" DECIMAL(12,3) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "delta" DECIMAL(12,3) NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "receipt_id" UUID,
    "meal_item_snapshot_id" UUID,
    "meal_record_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "meal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_template_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "StockUnit" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "plan_type" "PlanType" NOT NULL,
    "template_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "date_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "on_date" DATE NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "plan_type" "PlanType" NOT NULL,
    "template_id" UUID,
    "batch_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "date_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "meal_date" DATE NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "status" "MealStatus" NOT NULL DEFAULT 'unrecorded',
    "kind" "MealKind" NOT NULL DEFAULT 'home',
    "template_id" UUID,
    "outside_menu" TEXT,
    "outside_kcal" DECIMAL(12,3),
    "outside_carb_g" DECIMAL(12,3),
    "outside_protein_g" DECIMAL(12,3),
    "outside_fat_g" DECIMAL(12,3),
    "plan_changed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "eaten_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_item_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_record_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "planned_quantity" DECIMAL(12,3),
    "actual_quantity" DECIMAL(12,3),
    "unit" "StockUnit" NOT NULL,
    "basis_amount" DECIMAL(12,3),
    "basis_unit" "StockUnit",
    "kcal" DECIMAL(12,3),
    "carb_g" DECIMAL(12,3),
    "protein_g" DECIMAL(12,3),
    "fat_g" DECIMAL(12,3),
    "nutrition_source" "SnapshotNutritionSource",
    "backfilled_at" TIMESTAMPTZ(6),
    "deducts_stock" BOOLEAN NOT NULL DEFAULT true,
    "stock_check_needed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_item_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_completions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "on_date" DATE NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nutrition_complete" BOOLEAN NOT NULL,

    CONSTRAINT "day_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "on_date" DATE NOT NULL,
    "weight_kg" DECIMAL(6,2) NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goal_histories_user_id_effective_from_key" ON "goal_histories"("user_id", "effective_from");

-- CreateIndex
CREATE INDEX "products_user_id_name_idx" ON "products"("user_id", "name");

-- CreateIndex
CREATE INDEX "product_nutrition_versions_product_id_superseded_at_idx" ON "product_nutrition_versions"("product_id", "superseded_at");

-- CreateIndex
CREATE INDEX "purchases_user_id_status_idx" ON "purchases"("user_id", "status");

-- CreateIndex
CREATE INDEX "stock_receipts_user_id_product_id_idx" ON "stock_receipts"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_product_id_created_at_idx" ON "stock_movements"("user_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_meal_item_snapshot_id_idx" ON "stock_movements"("meal_item_snapshot_id");

-- CreateIndex
CREATE INDEX "meal_templates_user_id_idx" ON "meal_templates"("user_id");

-- CreateIndex
CREATE INDEX "meal_template_items_template_id_idx" ON "meal_template_items"("template_id");

-- CreateIndex
CREATE INDEX "meal_template_items_product_id_idx" ON "meal_template_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_schedules_user_id_weekday_slot_key" ON "weekly_schedules"("user_id", "weekday", "slot");

-- CreateIndex
CREATE INDEX "date_overrides_user_id_batch_id_idx" ON "date_overrides"("user_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "date_overrides_user_id_on_date_slot_key" ON "date_overrides"("user_id", "on_date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "meal_records_user_id_meal_date_slot_seq_key" ON "meal_records"("user_id", "meal_date", "slot", "seq");

-- CreateIndex
CREATE INDEX "meal_item_snapshots_meal_record_id_idx" ON "meal_item_snapshots"("meal_record_id");

-- CreateIndex
CREATE INDEX "meal_item_snapshots_product_id_kcal_idx" ON "meal_item_snapshots"("product_id", "kcal");

-- CreateIndex
CREATE UNIQUE INDEX "day_completions_user_id_on_date_key" ON "day_completions"("user_id", "on_date");

-- CreateIndex
CREATE UNIQUE INDEX "weight_records_user_id_on_date_key" ON "weight_records"("user_id", "on_date");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- AddForeignKey
ALTER TABLE "goal_histories" ADD CONSTRAINT "goal_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_nutrition_versions" ADD CONSTRAINT "product_nutrition_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "stock_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_meal_item_snapshot_id_fkey" FOREIGN KEY ("meal_item_snapshot_id") REFERENCES "meal_item_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_meal_record_id_fkey" FOREIGN KEY ("meal_record_id") REFERENCES "meal_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_templates" ADD CONSTRAINT "meal_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_overrides" ADD CONSTRAINT "date_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_overrides" ADD CONSTRAINT "date_overrides_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_records" ADD CONSTRAINT "meal_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_records" ADD CONSTRAINT "meal_records_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_item_snapshots" ADD CONSTRAINT "meal_item_snapshots_meal_record_id_fkey" FOREIGN KEY ("meal_record_id") REFERENCES "meal_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_item_snapshots" ADD CONSTRAINT "meal_item_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_completions" ADD CONSTRAINT "day_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_records" ADD CONSTRAINT "weight_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
