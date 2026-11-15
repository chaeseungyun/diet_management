-- CreateTable
CREATE TABLE "meal_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "meal_record_id" UUID,
    "path" TEXT NOT NULL,
    "thumb_path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),

    CONSTRAINT "meal_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_photos_user_id_created_at_idx" ON "meal_photos"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "meal_photos_meal_record_id_idx" ON "meal_photos"("meal_record_id");

-- CreateIndex
CREATE INDEX "meal_photos_expires_at_idx" ON "meal_photos"("expires_at");

-- AddForeignKey
ALTER TABLE "meal_photos" ADD CONSTRAINT "meal_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_photos" ADD CONSTRAINT "meal_photos_meal_record_id_fkey" FOREIGN KEY ("meal_record_id") REFERENCES "meal_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
