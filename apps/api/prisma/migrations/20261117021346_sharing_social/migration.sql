-- CreateTable
CREATE TABLE "meal_reactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_record_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_record_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_likes" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateIndex
CREATE INDEX "meal_reactions_user_id_idx" ON "meal_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_reactions_meal_record_id_user_id_key" ON "meal_reactions"("meal_record_id", "user_id");

-- CreateIndex
CREATE INDEX "meal_comments_meal_record_id_created_at_idx" ON "meal_comments"("meal_record_id", "created_at");

-- CreateIndex
CREATE INDEX "meal_comments_user_id_idx" ON "meal_comments"("user_id");

-- CreateIndex
CREATE INDEX "comment_likes_user_id_idx" ON "comment_likes"("user_id");

-- AddForeignKey
ALTER TABLE "meal_reactions" ADD CONSTRAINT "meal_reactions_meal_record_id_fkey" FOREIGN KEY ("meal_record_id") REFERENCES "meal_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_reactions" ADD CONSTRAINT "meal_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_comments" ADD CONSTRAINT "meal_comments_meal_record_id_fkey" FOREIGN KEY ("meal_record_id") REFERENCES "meal_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_comments" ADD CONSTRAINT "meal_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "meal_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
