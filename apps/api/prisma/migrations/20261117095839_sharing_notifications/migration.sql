-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'social';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'friend_reaction';
ALTER TYPE "NotificationType" ADD VALUE 'friend_comment';
ALTER TYPE "NotificationType" ADD VALUE 'comment_like';
ALTER TYPE "NotificationType" ADD VALUE 'friend_accepted';
