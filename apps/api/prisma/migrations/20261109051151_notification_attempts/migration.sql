-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "last_attempt_at" TIMESTAMPTZ(6),
ADD COLUMN     "payload" JSONB;
