-- CreateTable
CREATE TABLE "subscribers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirm_token" TEXT NOT NULL,
    "unsubscribe_token" TEXT NOT NULL,
    "subscribed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" DATETIME,
    "unsubscribed_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_email_key" ON "subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_confirm_token_key" ON "subscribers"("confirm_token");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_unsubscribe_token_key" ON "subscribers"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "subscribers_status_idx" ON "subscribers"("status");
