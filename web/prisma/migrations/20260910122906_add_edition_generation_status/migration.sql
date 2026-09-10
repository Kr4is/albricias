-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_editions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cadence" TEXT NOT NULL DEFAULT 'monthly',
    "period_start" DATETIME NOT NULL,
    "period_end" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "cover_image" TEXT,
    "vol" TEXT NOT NULL,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generation_status" TEXT NOT NULL DEFAULT 'done'
);
INSERT INTO "new_editions" ("cadence", "cover_image", "created_at", "id", "period_end", "period_start", "published_at", "status", "title", "vol") SELECT "cadence", "cover_image", "created_at", "id", "period_end", "period_start", "published_at", "status", "title", "vol" FROM "editions";
DROP TABLE "editions";
ALTER TABLE "new_editions" RENAME TO "editions";
CREATE INDEX "editions_status_idx" ON "editions"("status");
CREATE INDEX "editions_period_start_idx" ON "editions"("period_start");
CREATE UNIQUE INDEX "uq_edition_cadence_period_start" ON "editions"("cadence", "period_start");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
