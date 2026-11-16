-- CreateEnum
CREATE TYPE "ShareVisibility" AS ENUM ('private', 'friends');

-- CreateEnum
CREATE TYPE "FriendLinkStatus" AS ENUM ('pending', 'accepted', 'blocked');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "share_visibility" "ShareVisibility" NOT NULL DEFAULT 'private';

-- CreateTable
CREATE TABLE "friend_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_low_id" UUID NOT NULL,
    "user_high_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "FriendLinkStatus" NOT NULL,
    "blocked_by" UUID,
    "low_shares_to_high" BOOLEAN NOT NULL DEFAULT true,
    "high_shares_to_low" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "friend_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friend_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "friend_links_user_high_id_idx" ON "friend_links"("user_high_id");

-- CreateIndex
CREATE UNIQUE INDEX "friend_links_user_low_id_user_high_id_key" ON "friend_links"("user_low_id", "user_high_id");

-- CreateIndex
CREATE UNIQUE INDEX "friend_invites_code_key" ON "friend_invites"("code");

-- CreateIndex
CREATE INDEX "friend_invites_user_id_idx" ON "friend_invites"("user_id");

-- AddForeignKey
ALTER TABLE "friend_links" ADD CONSTRAINT "friend_links_user_low_id_fkey" FOREIGN KEY ("user_low_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_links" ADD CONSTRAINT "friend_links_user_high_id_fkey" FOREIGN KEY ("user_high_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_invites" ADD CONSTRAINT "friend_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
