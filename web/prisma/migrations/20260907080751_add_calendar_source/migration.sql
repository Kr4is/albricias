-- CreateTable
CREATE TABLE "calendar_sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "google_calendar_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'off',
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sources_google_calendar_id_key" ON "calendar_sources"("google_calendar_id");
