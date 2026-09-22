/**
 * Admin-only day view for one edition's daily-incremental generation
 * (`@/lib/generation/daily`, plan `daily-stars-only-bootstrap.md` §4) — a
 * read-mostly window onto a single UTC calendar day: its real status (see
 * {@link computeDayStatus} — "processed" is an evidence-based claim here, not
 * a cursor comparison), the repos starred that day (`ServiceActivity` rows,
 * `eventType: "star"`, no separate "day record" table), and a manual "process
 * this day now" action, offered for every day already over so a skipped day
 * always has a way back.
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

  const [stars, activityCount, run] = await Promise.all([
    prisma.serviceActivity.findMany({
      where: { editionId: edition.id, eventType: "star", timestamp: { gte: dayStart, lt: dayEnd } },
      orderBy: { timestamp: "asc" },
    }),
    // Any event type, not just stars — a day can have been processed and have
    // commits but no stars, and that is still evidence it ran.
    prisma.serviceActivity.count({
      where: { editionId: edition.id, timestamp: { gte: dayStart, lt: dayEnd } },
    }),
    // The recorded attempt, if any — what turns "no evidence" into the honest
    // "running" / "failed" / "ran, found nothing" the strip and grid show too.
    prisma.dayProcessingRun.findUnique({
      where: { editionId_date: { editionId: edition.id, date: dayStart } },
      select: { status: true, hadActivity: true, error: true },
    }),
  ]);

  const day = foldDayRun(
    computeDayStatus({
      dayStart,
      lastProcessedDay: edition.lastProcessedDay,
      hasActivity: activityCount > 0,
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
                const description = parseStarDescription(star.rawJson);
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
      </div>
    </NewspaperShell>
  );
}
