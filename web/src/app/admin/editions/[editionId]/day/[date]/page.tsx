/**
 * Admin-only day view for one edition's daily-incremental generation
 * (`@/lib/generation/daily`, plan `daily-stars-only-bootstrap.md` §4) — a
 * read-mostly window onto a single UTC calendar day: its real status (see
 * {@link computeDayStatus} — "processed" is an evidence-based claim here, not
 * a cursor comparison), everything the day's fetch stored (`ServiceActivity`
 * rows of every event type, grouped per type, no separate "day record" table —
 * with starred repos annotated by their persisted `Repo` facts when a run has
 * enriched them), and a manual "process this day now" action, offered for
 * every day already over so a skipped day always has a way back.
 *
 * `date` is `YYYY-MM-DD`, always read as a UTC calendar day — the same
 * `[dayStart, dayEnd)` convention `dayBounds()` (`@/lib/cadence`) already
 * gives the daily generation job, reused here directly rather than
 * reimplemented, so this page and that job never disagree about where one
 * day ends and the next begins.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { dayBounds } from "@/lib/cadence";
import {
  type DayStatus,
  canProcessDay,
  computeDayStatus,
  dayStatusLabel,
  foldDayRun,
} from "@/lib/generation/day-status";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

/** Flask's `<int:...>` converter: digits only. */
function parseEditionId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** `YYYY-MM-DD` -> UTC midnight `Date`, rejecting anything not a real calendar date. */
function parseDateParam(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/** `Date` (any UTC time) -> `YYYY-MM-DD`. */
function dateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const STATUS_STYLES: Record<DayStatus, string> = {
  processed: "text-green-700 bg-green-50",
  processing: "text-amber-800 bg-amber-100 animate-pulse",
  failed: "text-red-700 bg-red-100",
  skipped: "text-stone-600 bg-stone-100",
  today: "text-blue-700 bg-blue-50",
  pending: "text-amber-600 bg-amber-50",
};

async function loadEdition(editionId: string) {
  const id = parseEditionId(editionId);
  if (id === null) return null;
  return prisma.edition.findUnique({ where: { id } });
}

type LoadedEdition = NonNullable<Awaited<ReturnType<typeof loadEdition>>>;

/** True when `dayStart` (a UTC-midnight day) falls within the edition's `[periodStart, periodEnd)`. */
function dayWithinPeriod(dayStart: Date, edition: LoadedEdition): boolean {
  return dayStart.getTime() >= edition.periodStart.getTime() && dayStart.getTime() < edition.periodEnd.getTime();
}

/** Best-effort `description` out of a starred `ServiceActivity`'s cached GitHub repo payload. */
function parseStarDescription(rawJson: string | null): string | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return typeof parsed.description === "string" && parsed.description ? parsed.description : null;
  } catch {
    return null;
  }
}

/** `Repo`'s JSON columns are free-form text as far as the DB is concerned — a bad/absent value is just "no facts". */
function parseJsonField<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type RepoLanguage = { name?: unknown };
type RepoReleases = { count?: unknown; latestTag?: unknown };

/**
 * Non-star event types shown on this page, in render order. Everything the
 * daily fetch stores (`@/lib/sources/github`) except `star`, which keeps its
 * own enriched section below.
 */
const ACTIVITY_SECTIONS: ReadonlyArray<{ type: string; title: string }> = [
  { type: "commit", title: "Commits" },
  { type: "pr", title: "Pull Requests" },
  { type: "review", title: "Reviews" },
  { type: "issue", title: "Issues" },
  { type: "release", title: "Releases" },
  { type: "repo_created", title: "New Repos" },
  { type: "gist", title: "Gists" },
];

export async function generateMetadata({
  params,
}: PageProps<"/admin/editions/[editionId]/day/[date]">): Promise<Metadata> {
  const { editionId, date } = await params;
  const edition = await loadEdition(editionId);
  return { title: edition ? `${date} — ${edition.title} - Admin` : "Day Not Found - Admin" };
}

export default async function EditionDayPage({
  params,
  searchParams,
}: PageProps<"/admin/editions/[editionId]/day/[date]">) {
  const { editionId, date } = await params;
  const query = await searchParams;
  const messages = readFlash(query);

  const edition = await loadEdition(editionId);
  if (edition === null) notFound();

  const requestedDate = parseDateParam(date);
  if (requestedDate === null) notFound();

  const { periodStart: dayStart, periodEnd: dayEnd } = dayBounds(requestedDate);
  if (!dayWithinPeriod(dayStart, edition)) notFound();

  const today = dayBounds(new Date()).periodStart;

  const [activity, run] = await Promise.all([
    // Every event type, not just stars — a day can have been processed and have
    // commits but no stars, and that is still evidence it ran.
    prisma.serviceActivity.findMany({
      where: { editionId: edition.id, timestamp: { gte: dayStart, lt: dayEnd } },
      orderBy: { timestamp: "asc" },
    }),
    // The recorded attempt, if any — what turns "no evidence" into the honest
    // "running" / "failed" / "ran, found nothing" the strip and grid show too.
    prisma.dayProcessingRun.findUnique({
      where: { editionId_date: { editionId: edition.id, date: dayStart } },
      select: { status: true, hadActivity: true, error: true },
    }),
  ]);

  const stars = activity.filter((item) => item.eventType === "star");

  // Persisted facts for this day's starred repos (`Repo`, written by
  // `enrichStarredRepos`), joined by name rather than FK — one query for the
  // whole list, and simply absent for a repo no run has enriched yet.
  const starRepoNames = [...new Set(stars.map((star) => star.repo).filter((n): n is string => !!n))];
  const repoFacts = starRepoNames.length
    ? new Map(
        (await prisma.repo.findMany({ where: { fullName: { in: starRepoNames } } })).map((repo) => [
          repo.fullName,
          repo,
        ]),
      )
    : new Map<string, Awaited<ReturnType<typeof prisma.repo.findMany>>[number]>();

  const day = foldDayRun(
    computeDayStatus({
      dayStart,
      lastProcessedDay: edition.lastProcessedDay,
      hasActivity: activity.length > 0,
      today,
    }),
    run ?? undefined,
  );
  const status = day.status;
  // Already running: a second click would just be rejected by the route's claim.
  const canProcess = canProcessDay(dayStart, today) && status !== "processing";

  // Prev/next navigation, clamped to the edition's own period so this page
  // never links to a day outside `[periodStart, periodEnd)`.
  const periodFirstDay = dayBounds(edition.periodStart).periodStart;
  const periodLastDay = dayBounds(new Date(edition.periodEnd.getTime() - 1)).periodStart;
  const prevDay = new Date(dayStart.getTime() - 86_400_000);
  const nextDay = new Date(dayStart.getTime() + 86_400_000);
  const hasPrev = prevDay.getTime() >= periodFirstDay.getTime();
  const hasNext = nextDay.getTime() <= periodLastDay.getTime();

  const dayLabel = dayStart.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <NewspaperShell endpoint="admin.edition_edit">
      <div className="pb-16 fade-in">
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6 flex-wrap">
          <Link href="/admin/editions" className="hover:underline">
            Dashboard
          </Link>
          <span className="material-icons text-xs">chevron_right</span>
          <a href={`/admin/editions/${edition.id}/edit`} className="hover:underline">
            {edition.title}
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">{dateLabel(dayStart)}</span>
        </div>

        <FlashBanner messages={messages} />

        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <p
                className={`inline-block text-[10px] font-sans font-bold uppercase tracking-widest mb-1 px-1.5 py-0.5 ${STATUS_STYLES[status]}`}
              >
                {dayStatusLabel(day)}
              </p>
              <h2 className="font-masthead text-4xl">{dayLabel}</h2>
              <p className="text-xs font-sans text-stone-500 mt-1">{edition.title}</p>
              {status === "processing" && (
                <p className="text-xs font-sans text-stone-500 mt-2 max-w-xl">
                  This day is being fetched in the background right now. It keeps going whether or
                  not you stay on this page — reload in a moment to see the result.
                </p>
              )}
              {status === "failed" && (
                <p className="text-xs font-sans text-red-700 mt-2 max-w-xl">
                  The last run failed{day.error ? `: ${day.error}` : "."} Try processing it again.
                </p>
              )}
              {status === "skipped" && (
                <p className="text-xs font-sans text-stone-500 mt-2 max-w-xl">
                  Daily processing only ever covers the most recently completed day and never
                  backfills, so this day was passed over rather than processed. Fetch it now with the
                  button on the right.
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 no-print">
              {canProcess && (
                <form
                  method="POST"
                  action={`/admin/editions/${edition.id}/day/${dateLabel(dayStart)}/process`}
                  data-loading-submit
                >
                  <button
                    type="submit"
                    data-loading-text="Processing…"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                  >
                    <span className="material-icons text-sm">play_arrow</span>{" "}
                    {status === "processed" ? "Re-process this day" : "Process this day now"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* Prev/next day navigation, within the edition's period only. */}
        <div className="flex items-center justify-between mb-10 text-xs font-sans">
          {hasPrev ? (
            <a
              href={`/admin/editions/${edition.id}/day/${dateLabel(prevDay)}`}
              className="inline-flex items-center gap-1 text-stone-600 hover:text-ink hover:underline"
            >
              <span className="material-icons text-sm">chevron_left</span> {dateLabel(prevDay)}
            </a>
          ) : (
            <span />
          )}
          {hasNext ? (
            <a
              href={`/admin/editions/${edition.id}/day/${dateLabel(nextDay)}`}
              className="inline-flex items-center gap-1 text-stone-600 hover:text-ink hover:underline"
            >
              {dateLabel(nextDay)} <span className="material-icons text-sm">chevron_right</span>
            </a>
          ) : (
            <span />
          )}
        </div>

        <div>
          <h3 className="font-headline text-lg font-bold border-b border-ink pb-2 mb-5">
            Starred Repos ({stars.length})
          </h3>
          {stars.length > 0 ? (
            <ul className="space-y-3">
              {stars.map((star) => {
                const facts = star.repo ? (repoFacts.get(star.repo) ?? null) : null;
                const description = facts?.description ?? parseStarDescription(star.rawJson);
                const topLanguage = parseJsonField<RepoLanguage[]>(facts?.languages ?? null)?.[0]
                  ?.name;
                const releases = parseJsonField<RepoReleases>(facts?.latestRelease ?? null);
                // Three states: never enriched (no row), never *once* enriched
                // (row, error, no `lastEnrichedAt`), and enriched-then-failed —
                // which still has real, if ageing, figures worth showing.
                const neverEnriched = facts !== null && !facts.lastEnrichedAt;
                const topics = neverEnriched
                  ? []
                  : (parseJsonField<string[]>(facts?.topics ?? null) ?? []);
                const chips: string[] = facts?.lastEnrichedAt
                  ? [
                      facts.stargazersCount !== null
                        ? `★ ${facts.stargazersCount.toLocaleString("en-US")}`
                        : null,
                      facts.forksCount !== null
                        ? `⑂ ${facts.forksCount.toLocaleString("en-US")}`
                        : null,
                      typeof topLanguage === "string" ? topLanguage : null,
                      facts.license,
                      typeof releases?.count === "number" &&
                      releases.count > 0 &&
                      typeof releases.latestTag === "string"
                        ? releases.latestTag
                        : null,
                    ].filter((chip): chip is string => !!chip)
                  : [];
                return (
                  <li
                    key={star.id}
                    className="border border-stone-200 bg-white p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-headline font-bold text-base">
                        {star.url ? (
                          <a
                            href={star.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {star.repo ?? star.title}
                          </a>
                        ) : (
                          (star.repo ?? star.title)
                        )}
                      </p>
                      {description && (
                        <p className="text-xs font-sans text-stone-500 mt-0.5">{description}</p>
                      )}
                      {chips.length > 0 && (
                        <p className="text-xs font-sans text-stone-600 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                          {chips.map((chip) => (
                            <span key={chip}>{chip}</span>
                          ))}
                        </p>
                      )}
                      {topics.length > 0 && (
                        <p className="mt-2 flex flex-wrap gap-1">
                          {topics.slice(0, 8).map((topic) => (
                            <span
                              key={topic}
                              className="text-[10px] font-sans text-stone-600 bg-stone-100 px-1.5 py-0.5"
                            >
                              {topic}
                            </span>
                          ))}
                        </p>
                      )}
                      {facts?.enrichError && (
                        <p className="text-[10px] font-sans text-red-700 mt-1.5">
                          {neverEnriched
                            ? `Never enriched: ${facts.enrichError}`
                            : `Figures may be stale — last refresh failed: ${facts.enrichError}`}
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] font-sans text-stone-400 shrink-0 whitespace-nowrap">
                      {star.timestamp ? star.timestamp.toISOString() : "—"}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-center py-10 border-2 border-dashed border-stone-200">
              <span className="material-icons text-4xl text-stone-300 block mb-2">star_outline</span>
              <p className="font-serif italic text-stone-500">No stars recorded this day.</p>
            </div>
          )}
        </div>

        {/* Everything else the day's fetch stored — one section per event type
            that actually has rows, empty types omitted entirely. */}
        {ACTIVITY_SECTIONS.map(({ type, title }) => {
          const items = activity.filter((item) => item.eventType === type);
          if (items.length === 0) return null;
          return (
            <div key={type} className="mt-10">
              <h3 className="font-headline text-lg font-bold border-b border-ink pb-2 mb-5">
                {title} ({items.length})
              </h3>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="border border-stone-200 bg-white p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-headline font-bold text-base">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {item.title}
                          </a>
                        ) : (
                          item.title
                        )}
                      </p>
                      {item.repo && (
                        <p className="text-xs font-sans text-stone-500 mt-0.5">{item.repo}</p>
                      )}
                    </div>
                    <p className="text-[10px] font-sans text-stone-400 shrink-0 whitespace-nowrap">
                      {item.timestamp ? item.timestamp.toISOString() : "—"}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </NewspaperShell>
  );
}
