-- AlterTable
ALTER TABLE "articles" ADD COLUMN "day_date" DATETIME;

-- AlterTable
ALTER TABLE "day_processing_runs" ADD COLUMN "post_progress" TEXT;
ALTER TABLE "day_processing_runs" ADD COLUMN "post_status" TEXT;

-- CreateTable
CREATE TABLE "article_repo_mentions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "article_id" INTEGER NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    CONSTRAINT "article_repo_mentions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "article_repo_mentions_repo_full_name_idx" ON "article_repo_mentions"("repo_full_name");

-- CreateIndex
CREATE UNIQUE INDEX "article_repo_mentions_article_id_repo_full_name_key" ON "article_repo_mentions"("article_id", "repo_full_name");

-- CreateIndex
CREATE UNIQUE INDEX "articles_edition_id_day_date_key" ON "articles"("edition_id", "day_date");
