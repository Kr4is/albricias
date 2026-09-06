/**
 * One-off data migration: the legacy Flask/SQLAlchemy `albricias.db` -> the
 * new Prisma-managed SQLite database (`web/dev.db` in dev, or wherever
 * `DATABASE_URL` points in production).
 *
 * Reads `editions`, `articles`, `service_activities`, `service_tokens`
 * directly via `better-sqlite3` against the old DB file (read-only) — no
 * dependency on Flask/SQLAlchemy being importable. Every historical
 * (month, year) edition becomes `cadence="monthly"` with `periodStart`/
 * `periodEnd` set to that calendar month's UTC bounds, using the exact same
 * math as `monthPeriodBounds` in `src/lib/cadence.ts` (imported dynamically
 * below, not reimplemented). All other rows are copied across with their
 * original integer IDs preserved, so existing hardcoded references (and
 * published-edition URLs, which are just `/edition/<id>`) keep working.
 *
 * SQLite's own AUTOINCREMENT bookkeeping (`sqlite_sequence`) is updated
 * automatically by an explicit-id INSERT — verified empirically against a
 * scratch DB — so no manual sequence reset is needed after this script runs.
 *
 * Table/column names in the Prisma schema are `@map`/`@@map`-ed to the
 * original Flask snake_case names (see `prisma/schema.prisma`), so this is a
 * row-for-row copy, not a reshaping migration, apart from the edition period
 * columns.
 *
 * Usage (run from `web/`):
 *   npx tsx scripts/migrate-from-flask.ts [options]
 *
 * Options:
 *   --source <path>   Path to the old Flask SQLite DB.
 *                      Default: <repo-root>/albricias.db
 *   --target <path>   Path to the new Prisma-managed SQLite DB.
 *                      Default: resolved from DATABASE_URL (falls back to ./dev.db)
 *   --dry-run         Read and report counts/preview without writing anything.
 *   --force           Allow migrating into a target that already has rows in
 *                      these tables, upserting (INSERT OR REPLACE) by id
 *                      instead of the default fail-fast empty-target check.
 *
 * IMPORTANT: never point --target at a database you care about without a
 * backup — always run this against a throwaway copy first. See
 * `.omc/notepads/react-mastra-rewrite/phase-5.md` for the verification
 * procedure this script was checked against.
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");

const MIGRATED_TABLES = ["editions", "articles", "service_activities", "service_tokens"] as const;
type MigratedTable = (typeof MIGRATED_TABLES)[number];

interface Args {
  source: string;
  target: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  let source: string | undefined;
  let target: string | undefined;
  let dryRun = false;
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      source = argv[++i];
    } else if (arg === "--target") {
      target = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    source: path.resolve(source ?? path.join(REPO_ROOT, "albricias.db")),
    target: path.resolve(target ?? resolveDefaultTarget()),
    dryRun,
    force,
  };
}

function printHelp(): void {
  console.log(
    [
      "Usage: npx tsx scripts/migrate-from-flask.ts [options]",
      "",
      "Options:",
      "  --source <path>   Old Flask SQLite DB (default: <repo-root>/albricias.db)",
      "  --target <path>   New Prisma-managed SQLite DB (default: from DATABASE_URL, else ./dev.db)",
      "  --dry-run         Report what would happen without writing anything",
      "  --force           Allow a non-empty target (upserts by id instead of failing)",
    ].join("\n"),
  );
}

/** Mirrors how `web/src/lib/prisma.ts` resolves `DATABASE_URL="file:./dev.db"` relative to `web/`. */
function resolveDefaultTarget(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const filePath = url.replace(/^file:/, "");
  return path.resolve(WEB_ROOT, filePath);
}

/**
 * Parse a value read back from a SQLAlchemy-managed SQLite column into a
 * `Date`. SQLAlchemy's default SQLite dialect stores naive (UTC) datetimes as
 * `"YYYY-MM-DD HH:MM:SS[.ffffff]"` and `db.Date` columns as `"YYYY-MM-DD"`.
 */
function parseSqlAlchemyDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T00:00:00.000Z`);
  }

  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(s);
  if (m) {
    const fractional = m[3] ? Number(`0${m[3]}`) : 0;
    const millis = Math.round(fractional * 1000);
    return new Date(`${m[1]}T${m[2]}.${String(millis).padStart(3, "0")}Z`);
  }

  // Defensive fallback for an already-ISO-ish value; assume UTC if no offset given.
  const hasOffset = /Z$|[+-]\d{2}:\d{2}$/.test(s);
  const d = new Date(hasOffset ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Unrecognised date/time value from source DB: ${JSON.stringify(raw)}`);
  }
  return d;
}

/**
 * Store a `Date` as the exact ISO-8601 text format
 * `@prisma/adapter-better-sqlite3` itself writes for a `Date` argument
 * (`mapArg` in the adapter: `date.toISOString().replace("Z", "+00:00")`).
 *
 * This match matters, not just for round-tripping through `findMany`: the
 * app's own queries filter and order on these columns with range
 * comparisons (`editions.ts`'s `previousPublishedEdition`/`nextPublishedEdition`/
 * `yearRange`, `admin/editions/generate`'s cadence-period lookup), which
 * Prisma compiles into `WHERE period_start >= ?` with a TEXT-bound
 * parameter. SQLite's type-affinity rules always sort TEXT greater than any
 * INTEGER/REAL regardless of value, so storing these columns as epoch-ms
 * integers (as this codebase's own scratch-seed script does, harmlessly,
 * since it never range-filters) silently breaks every such comparison —
 * verified: it makes the archive year filter return zero rows even when
 * matching editions exist. TEXT-vs-TEXT comparison has no such trap.
 */
function toPrismaDateTimeString(d: Date | null): string | null {
  return d ? d.toISOString().replace("Z", "+00:00") : null;
}

function tableRowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
  return row.n;
}

function assertTableExists(db: Database.Database, table: string, label: string): void {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  if (!row) {
    throw new Error(`${label} database is missing the "${table}" table — is this the right file?`);
  }
}

interface OldEditionRow {
  id: number;
  month: number;
  year: number;
  title: string;
  status: string;
  cover_image: string | null;
  vol: string;
  published_at: string | null;
  created_at: string;
}

interface OldArticleRow {
  id: number;
  edition_id: number;
  title: string;
  content: string;
  category: string;
  author: string | null;
  deck: string;
  order: number;
  date: string | null;
  image: string | null;
  audio: string | null;
  video: string | null;
  source_type: string;
  source_data: string | null;
  created_at: string;
  updated_at: string;
}

interface OldServiceActivityRow {
  id: number;
  edition_id: number;
  source: string;
  event_type: string;
  repo: string | null;
  title: string;
  url: string | null;
  timestamp: string | null;
  raw_json: string | null;
}

interface OldServiceTokenRow {
  id: number;
  service: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  updated_at: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log("Albricias data migration: Flask SQLite -> Prisma SQLite");
  console.log(`  source: ${args.source}`);
  console.log(`  target: ${args.target}`);
  console.log(`  dry-run: ${args.dryRun}`);
  console.log(`  force:   ${args.force}`);
  console.log("");

  if (!existsSync(args.source)) {
    console.log(
      `No Flask database found at ${args.source} — nothing to migrate. ` +
        "This is expected if the Flask app has never been run (no data yet); " +
        "this script is otherwise ready to use once that file exists.",
    );
    return;
  }

  if (!existsSync(args.target)) {
    throw new Error(
      `Target database ${args.target} does not exist. Create it first with the Prisma schema ` +
        "applied (e.g. `npx prisma migrate deploy` from web/), then re-run this script.",
    );
  }

  // Resolve monthPeriodBounds dynamically, after DATABASE_URL is known, so
  // `src/lib/prisma.ts`'s module-level PrismaClient (a side effect of
  // importing `src/lib/cadence.ts`) points at the same target file this
  // script is about to write to. The adapter only opens the file lazily on
  // first query, and this script never issues one through it, so there is no
  // conflict with the direct better-sqlite3 connection opened below.
  process.env.DATABASE_URL = `file:${args.target}`;
  const cadenceModulePath = path.join(WEB_ROOT, "src", "lib", "cadence.ts");
  const { monthPeriodBounds } = (await import(cadenceModulePath)) as {
    monthPeriodBounds: (year: number, month: number) => { periodStart: Date; periodEnd: Date };
  };

  const source = new Database(args.source, { readonly: true, fileMustExist: true });
  const target = new Database(args.target, { fileMustExist: true });
  target.pragma("foreign_keys = ON");

  try {
    for (const table of MIGRATED_TABLES) {
      assertTableExists(source, table, "Source");
      assertTableExists(target, table, "Target");
    }

    const sourceCounts: Record<MigratedTable, number> = {
      editions: tableRowCount(source, "editions"),
      articles: tableRowCount(source, "articles"),
      service_activities: tableRowCount(source, "service_activities"),
      service_tokens: tableRowCount(source, "service_tokens"),
    };

    console.log("Source row counts:");
    for (const table of MIGRATED_TABLES) console.log(`  ${table}: ${sourceCounts[table]}`);
    console.log("");

    const targetCountsBefore: Record<MigratedTable, number> = {
      editions: tableRowCount(target, "editions"),
      articles: tableRowCount(target, "articles"),
      service_activities: tableRowCount(target, "service_activities"),
      service_tokens: tableRowCount(target, "service_tokens"),
    };
    const targetHasData = Object.values(targetCountsBefore).some((n) => n > 0);

    if (targetHasData && !args.force) {
      console.log("Target row counts (before):");
      for (const table of MIGRATED_TABLES) console.log(`  ${table}: ${targetCountsBefore[table]}`);
      throw new Error(
        "Target database already has rows in one or more migrated tables. Refusing to run " +
          "(this script is not safe to re-run blindly). Pass --force to upsert by id instead, " +
          "or point --target at a fresh database.",
      );
    }

    if (args.dryRun) {
      console.log("Dry run: no rows written. Re-run without --dry-run to perform the migration.");
      return;
    }

    const insertMode = targetHasData && args.force ? "INSERT OR REPLACE" : "INSERT";

    const insertEdition = target.prepare(
      `${insertMode} INTO editions
         (id, cadence, period_start, period_end, title, status, cover_image, vol, published_at, created_at)
       VALUES (@id, 'monthly', @periodStart, @periodEnd, @title, @status, @coverImage, @vol, @publishedAt, @createdAt)`,
    );
    const insertArticle = target.prepare(
      `${insertMode} INTO articles
         (id, edition_id, title, content, category, author, deck, "order", date,
          image, audio, video, source_type, source_data, created_at, updated_at)
       VALUES (@id, @editionId, @title, @content, @category, @author, @deck, @order, @date,
               @image, @audio, @video, @sourceType, @sourceData, @createdAt, @updatedAt)`,
    );
    const insertServiceActivity = target.prepare(
      `${insertMode} INTO service_activities
         (id, edition_id, source, event_type, repo, title, url, timestamp, raw_json)
       VALUES (@id, @editionId, @source, @eventType, @repo, @title, @url, @timestamp, @rawJson)`,
    );
    const insertServiceToken = target.prepare(
      `${insertMode} INTO service_tokens
         (id, service, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (@id, @service, @accessToken, @refreshToken, @expiresAt, @scope, @updatedAt)`,
    );

    const migrate = target.transaction(() => {
      const editions = source.prepare(`SELECT * FROM editions`).all() as OldEditionRow[];
      for (const row of editions) {
        const { periodStart, periodEnd } = monthPeriodBounds(row.year, row.month);
        insertEdition.run({
          id: row.id,
          periodStart: toPrismaDateTimeString(periodStart),
          periodEnd: toPrismaDateTimeString(periodEnd),
          title: row.title,
          status: row.status,
          coverImage: row.cover_image,
          vol: row.vol,
          publishedAt: toPrismaDateTimeString(parseSqlAlchemyDate(row.published_at)),
          createdAt: toPrismaDateTimeString(parseSqlAlchemyDate(row.created_at)),
        });
      }

      const articles = source.prepare(`SELECT * FROM articles`).all() as OldArticleRow[];
      for (const row of articles) {
        insertArticle.run({
          id: row.id,
          editionId: row.edition_id,
          title: row.title,
          content: row.content,
          category: row.category,
          author: row.author,
          deck: row.deck,
          order: row.order,
          date: toPrismaDateTimeString(parseSqlAlchemyDate(row.date)),
          image: row.image,
          audio: row.audio,
          video: row.video,
          sourceType: row.source_type,
          sourceData: row.source_data,
          createdAt: toPrismaDateTimeString(parseSqlAlchemyDate(row.created_at)),
          updatedAt: toPrismaDateTimeString(parseSqlAlchemyDate(row.updated_at)),
        });
      }

      const activities = source
        .prepare(`SELECT * FROM service_activities`)
        .all() as OldServiceActivityRow[];
      for (const row of activities) {
        insertServiceActivity.run({
          id: row.id,
          editionId: row.edition_id,
          source: row.source,
          eventType: row.event_type,
          repo: row.repo,
          title: row.title,
          url: row.url,
          timestamp: toPrismaDateTimeString(parseSqlAlchemyDate(row.timestamp)),
          rawJson: row.raw_json,
        });
      }

      const tokens = source.prepare(`SELECT * FROM service_tokens`).all() as OldServiceTokenRow[];
      for (const row of tokens) {
        insertServiceToken.run({
          id: row.id,
          service: row.service,
          accessToken: row.access_token,
          refreshToken: row.refresh_token,
          expiresAt: toPrismaDateTimeString(parseSqlAlchemyDate(row.expires_at)),
          scope: row.scope,
          updatedAt: toPrismaDateTimeString(parseSqlAlchemyDate(row.updated_at)),
        });
      }
    });

    migrate();

    const targetCountsAfter: Record<MigratedTable, number> = {
      editions: tableRowCount(target, "editions"),
      articles: tableRowCount(target, "articles"),
      service_activities: tableRowCount(target, "service_activities"),
      service_tokens: tableRowCount(target, "service_tokens"),
    };

    console.log("Target row counts (after):");
    let allMatch = true;
    for (const table of MIGRATED_TABLES) {
      const expected = insertMode === "INSERT" ? targetCountsBefore[table] + sourceCounts[table] : "n/a (force mode)";
      const ok = insertMode === "INSERT" ? targetCountsAfter[table] === expected : true;
      allMatch &&= ok;
      console.log(`  ${table}: ${targetCountsAfter[table]} (expected ${expected})${ok ? "" : "  <-- MISMATCH"}`);
    }
    console.log("");
    console.log(allMatch ? "Row counts match. Migration complete." : "Row count mismatch — investigate before trusting this data.");
  } finally {
    source.close();
    target.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
