-- CreateTable
CREATE TABLE "social_accounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "service" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credentials_json" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_service_key" ON "social_accounts"("service");
