-- CreateTable
CREATE TABLE "day_processing_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "edition_id" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "had_activity" BOOLEAN,
    "error" TEXT,
    CONSTRAINT "day_processing_runs_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "editions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "day_processing_runs_edition_id_date_key" ON "day_processing_runs"("edition_id", "date");
