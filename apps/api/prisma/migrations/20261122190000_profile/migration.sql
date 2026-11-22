-- 프로필 사진·상태 메시지 (DEC-104)
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_id" UUID,
ADD COLUMN     "status_message" TEXT;
