-- 식단 외 식사 메뉴를 여러 줄로 (DEC-103)
-- CreateTable
CREATE TABLE "meal_outside_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_record_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kcal" DECIMAL(12,3),
    "carb_g" DECIMAL(12,3),
    "protein_g" DECIMAL(12,3),
    "fat_g" DECIMAL(12,3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_outside_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_outside_items_meal_record_id_idx" ON "meal_outside_items"("meal_record_id");

-- AddForeignKey
ALTER TABLE "meal_outside_items" ADD CONSTRAINT "meal_outside_items_meal_record_id_fkey" FOREIGN KEY ("meal_record_id") REFERENCES "meal_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 메뉴명·영양(기록당 한 벌)을 줄 하나로 옮긴 뒤 컬럼을 지운다 (수동 SQL).
-- 식단 외로 먹은 기록은 빠짐없이 옮긴다: 메뉴명이 빈 행이 있더라도 줄 없는 기록(= 0 kcal 확정)이 되지 않게 이름을 채운다
INSERT INTO "meal_outside_items" ("meal_record_id", "name", "kcal", "carb_g", "protein_g", "fat_g", "sort_order")
SELECT "id", COALESCE(NULLIF(btrim("outside_menu"), ''), '식단 외 식사'), "outside_kcal", "outside_carb_g", "outside_protein_g", "outside_fat_g", 0
FROM "meal_records"
WHERE "kind" = 'outside' AND "status" = 'eaten';

-- AlterTable
ALTER TABLE "meal_records" DROP COLUMN "outside_carb_g",
DROP COLUMN "outside_fat_g",
DROP COLUMN "outside_kcal",
DROP COLUMN "outside_menu",
DROP COLUMN "outside_protein_g";
