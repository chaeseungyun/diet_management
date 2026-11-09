-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('breakfast', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack', 'unrecorded_remind', 'stock_depletion');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('meal_check', 'unrecorded_remind', 'stock_depletion');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notify_minute" INTEGER,
    "remind_after_minutes" INTEGER NOT NULL DEFAULT 60,
    "remind_max_count" INTEGER NOT NULL DEFAULT 1,
    "days_before" INTEGER NOT NULL DEFAULT 3,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "target_date" DATE NOT NULL,
    "target_key" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "slot" "MealSlot",
    "product_id" UUID,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_user_id_kind_key" ON "notification_settings"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_scheduled_at_idx" ON "notification_deliveries"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_user_id_type_target_date_target_key_key" ON "notification_deliveries"("user_id", "type", "target_date", "target_key", "seq");

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
