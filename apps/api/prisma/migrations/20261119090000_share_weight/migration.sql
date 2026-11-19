-- 몸무게 친구 공개 (DEC-101): 전체 스위치와 친구별 방향 스위치, 모두 기본 꺼짐
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "share_weight" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "friend_links" ADD COLUMN     "high_shares_weight_to_low" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "low_shares_weight_to_high" BOOLEAN NOT NULL DEFAULT false;
