/**
 * Shared PrismaClient instance.
 *
 * Prisma 7 requires an explicit driver adapter; SQLite is served by
 * `@prisma/adapter-better-sqlite3`, matching the Flask app's
 * `sqlite:///albricias.db` deployment model.
 *
 * The client is cached on `globalThis` so Next.js dev-mode hot reloads don't
 * open a new SQLite connection on every recompile.
 */

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
