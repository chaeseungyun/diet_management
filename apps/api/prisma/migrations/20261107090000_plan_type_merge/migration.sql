-- D-19: 계획 유형 '외부 식사 예정'(outside) 을 자유 끼니(none) 에 합친다.
-- 기존 데이터 이전: 식단표의 outside 칸은 none 과 같으므로 행을 지우고(빠진 칸 = 자유 끼니),
-- 날짜 예외의 outside 는 의도(출장 등)를 남기기 위해 none 으로 바꾼다.
DELETE FROM "weekly_schedules" WHERE "plan_type" = 'outside';
UPDATE "date_overrides" SET "plan_type" = 'none' WHERE "plan_type" = 'outside';

-- AlterEnum
BEGIN;
CREATE TYPE "PlanType_new" AS ENUM ('template', 'none');
ALTER TABLE "weekly_schedules" ALTER COLUMN "plan_type" TYPE "PlanType_new" USING ("plan_type"::text::"PlanType_new");
ALTER TABLE "date_overrides" ALTER COLUMN "plan_type" TYPE "PlanType_new" USING ("plan_type"::text::"PlanType_new");
ALTER TYPE "PlanType" RENAME TO "PlanType_old";
ALTER TYPE "PlanType_new" RENAME TO "PlanType";
DROP TYPE "public"."PlanType_old";
COMMIT;
