-- CreateTable
CREATE TABLE "editions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cadence" TEXT NOT NULL DEFAULT 'monthly',
    "period_start" DATETIME NOT NULL,
    "period_end" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "cover_image" TEXT,
    "vol" TEXT NOT NULL,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "articles" (
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "articles_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "editions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "service_activities" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "edition_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'github',
    "event_type" TEXT NOT NULL,
    "repo" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "timestamp" DATETIME,
    "raw_json" TEXT,
    CONSTRAINT "service_activities_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "editions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "service_tokens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "service" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" DATETIME,
    "scope" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "editions_status_idx" ON "editions"("status");

-- CreateIndex
CREATE INDEX "editions_period_start_idx" ON "editions"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "uq_edition_cadence_period_start" ON "editions"("cadence", "period_start");

-- CreateIndex
CREATE INDEX "articles_edition_id_idx" ON "articles"("edition_id");

-- CreateIndex
CREATE INDEX "articles_edition_id_order_idx" ON "articles"("edition_id", "order");

-- CreateIndex
CREATE INDEX "service_activities_edition_id_idx" ON "service_activities"("edition_id");

-- CreateIndex
CREATE INDEX "service_activities_source_idx" ON "service_activities"("source");

-- CreateIndex
CREATE UNIQUE INDEX "service_tokens_service_key" ON "service_tokens"("service");
