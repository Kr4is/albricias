-- CreateTable
CREATE TABLE "repos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "full_name" TEXT NOT NULL,
    "description" TEXT,
    "stargazers_count" INTEGER,
    "forks_count" INTEGER,
    "open_issues_count" INTEGER,
    "subscribers_count" INTEGER,
    "license" TEXT,
    "topics" TEXT,
    "languages" TEXT,
    "latest_release" TEXT,
    "weekly_commits" TEXT,
    "last_enriched_at" DATETIME,
    "enrich_error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "repos_full_name_key" ON "repos"("full_name");
