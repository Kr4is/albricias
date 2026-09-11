-- AlterTable
ALTER TABLE "editions" ADD COLUMN "curator_marks" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_articles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "edition_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "author" TEXT,
    "deck" TEXT NOT NULL DEFAULT 'A',
    "order" INTEGER NOT NULL DEFAULT 0,
    "date" DATETIME,
    "image" TEXT,
    "audio" TEXT,
    "video" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'manual',
    "source_data" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "articles_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "editions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_articles" ("audio", "author", "category", "content", "created_at", "date", "deck", "edition_id", "id", "image", "order", "source_data", "source_type", "title", "updated_at", "video") SELECT "audio", "author", "category", "content", "created_at", "date", "deck", "edition_id", "id", "image", "order", "source_data", "source_type", "title", "updated_at", "video" FROM "articles";
DROP TABLE "articles";
ALTER TABLE "new_articles" RENAME TO "articles";
CREATE INDEX "articles_edition_id_idx" ON "articles"("edition_id");
CREATE INDEX "articles_edition_id_order_idx" ON "articles"("edition_id", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
