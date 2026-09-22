/**
 * What a single calendar day's processing status actually is, for the admin
 * views that show it (`/admin/editions/[editionId]/day/[date]` and the day
 * strip on `.../edit`).
 *
 * Shared rather than duplicated per page — not for the usual
 * don't-repeat-yourself reason but because the rule below is subtle enough
 * that two copies drifted into the same wrong answer once already, and a day
 * strip that disagrees with the day page it links to is worse than either
 * being wrong alone.
 */

import { dayBounds } from "@/lib/cadence";
import { prisma } from "@/lib/prisma";

/**
 * - `processed` — this day really was processed (evidence, or a finished
 *   `DayProcessingRun` — including one that legitimately found nothing, which
 *   the label distinguishes; see {@link dayStatusLabel}).
 * - `processing` — a `DayProcessingRun` row for this day is still `running`.
 * - `failed` — this day's last run threw.
 * - `skipped` — a day already over that was never processed and never will be
 *   automatically. Daily processing does not backfill.
 * - `today` — the current UTC day: in progress, not yet due.
 * - `pending` — not yet due: a future day, or yesterday before the daily cron
 *   has reached it.
 */
export type DayStatus = "processed" | "processing" | "failed" | "skipped" | "today" | "pending";

export interface DayStatusInput {
  /** UTC midnight of the day being judged. */
  dayStart: Date;
  /** The edition's `lastProcessedDay` cursor. */
  lastProcessedDay: Date | null;
  /** Whether this edition has any `ServiceActivity` row inside this day's range. */
  hasActivity: boolean;
  /** UTC midnight of the current day. */
  today: Date;
}

/**
 * A day's status — deliberately **not** `dayStart <= lastProcessedDay`.
 *
 * That comparison was only ever right under the old day-by-day catch-up walk,
 * where the cursor could not pass a day without processing it.
 * `processYesterdayIfNeeded` (`./daily.ts`) now jumps `lastProcessedDay`
 * straight to yesterday and never backfills, so on a mid-period cold start
 * every earlier day of the period sits *below* the cursor while never having
 * been processed at all — and reading the cursor alone reported all of them as
 * processed, with zero stars and nothing to suggest otherwise.
 *
 * Nothing in the schema records "this specific day was processed", so the
 * claim is made on evidence instead: a past day counts as processed when it
 * holds `ServiceActivity` rows of its own, or when it is the exact day the
 * cursor points at — the one day a jump genuinely processed, and the only day
 * for which "processed but legitimately empty" is a real possibility. Every
 * other past day is `skipped`, which is the honest answer even in the case
 * where it happens to be pessimistic (a genuinely empty day further back).
 * An admin can always settle it by processing the day.
 */
export function computeDayStatus({ dayStart, lastProcessedDay, hasActivity, today }: DayStatusInput): DayStatus {
  if (dayStart.getTime() === today.getTime()) return "today";
  if (dayStart.getTime() > today.getTime()) return "pending";

  if (hasActivity) return "processed";
  const cursor = lastProcessedDay ? dayBounds(lastProcessedDay).periodStart : null;
  if (cursor && dayStart.getTime() === cursor.getTime()) return "processed";

  // Yesterday isn't skipped — it's simply not due until the daily cron runs.
  if (dayStart.getTime() === today.getTime() - 86_400_000) return "pending";
  return "skipped";
}

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  processed: "Processed",
  processing: "Processing…",
  failed: "Failed",
  skipped: "Never processed",
  today: "Today",
  pending: "Pending",
};

/** One day, as the admin views need it: status plus what a run row added. */
export interface DayInfo {
  date: Date;
  dateStr: string;
  status: DayStatus;
  /** Only on a finished run: whether it found any GitHub activity at all. */
  hadActivity?: boolean;
  /** Only on `failed`. */
  error?: string;
}

/** The run row shape {@link foldDayRun} needs — a `DayProcessingRun`, narrowed. */
export interface DayRunRow {
  status: string;
  hadActivity: boolean | null;
  error: string | null;
}

/**
 * Fold this day's `DayProcessingRun` row (if any) over the evidence-based
 * status from {@link computeDayStatus}.
 *
 * A recorded attempt beats inferred evidence: a finished run is `processed`
 * even when it found nothing (that's the whole point of recording attempts —
 * "tried, day was empty" used to be indistinguishable from "never tried"). No
 * row at all keeps the evidence answer untouched, which is what the automatic
 * daily cron leaves behind — it never writes a run row.
 */
export function foldDayRun(base: DayStatus, run: DayRunRow | undefined): Omit<DayInfo, "date" | "dateStr"> {
  if (!run) return { status: base };
  if (run.status === "running") return { status: "processing" };
  if (run.status === "failed") return { status: "failed", error: run.error ?? undefined };
  return { status: "processed", hadActivity: run.hadActivity ?? undefined };
}

/** Label for a day, distinguishing a run that finished empty from a normal one. */
export function dayStatusLabel({ status, hadActivity }: Pick<DayInfo, "status" | "hadActivity">): string {
  if (status === "processed" && hadActivity === false) return "Processed (no activity)";
  return DAY_STATUS_LABELS[status];
}

/**
 * Whether a day can be processed manually at all: only one already over.
 *
 * Gated on the date, never on {@link DayStatus} — the days that most need the
 * admin day view's "process this day now" are exactly the `skipped` ones, so
 * hiding the button behind a status label is how it came to be unavailable
 * precisely when it was needed. Re-processing an already-processed day is
 * safe too (`replaceDayActivities` owns the day's whole range), so the button
 * stays offered. Today and future days are never offered: their data isn't
 * complete yet, and a partial fetch would look like a finished one.
 */
export function canProcessDay(dayStart: Date, today: Date): boolean {
  return dayStart.getTime() < today.getTime();
}

/**
 * One square's/entry's colour by {@link DayStatus} — shared by the `edit`
 * page's `DayStrip` and the admin dashboard's day list so the two can never
 * disagree about what a status looks like.
 *
 * Red now belongs to `failed` alone: a day whose run actually threw is the
 * alarming one. `skipped` steps back to a muted grey — a day nobody ever
 * attempted is a mild signal, still darker than `pending` (a future day, with
 * nothing to do yet). `processing` pulses, which is the whole status in one
 * class, no client JS.
 */
export const DAY_STRIP_STYLES: Record<DayStatus, string> = {
  processed: "bg-green-600",
  processing: "bg-amber-500 animate-pulse",
  failed: "bg-red-600",
  skipped: "bg-stone-300 border border-stone-400 text-stone-600",
  today: "bg-blue-600",
  pending: "bg-stone-100 border border-stone-200 text-stone-400",
};

/**
 * Every day of `edition`'s whole period (including days still to come) with
 * its {@link DayStatus} — the data `DayStrip` (`.../edit/page.tsx`) renders
 * as small squares, also consumed by the admin dashboard's day list.
 * `computeDayStatus` already labels a day past today as `pending`, so the
 * caller doesn't need to clamp the range itself. Moved here verbatim from
 * `DayStrip` so both call sites share one query/loop instead of drifting.
 */
export async function getEditionDayStatuses(edition: {
  id: number;
  periodStart: Date;
  periodEnd: Date;
  lastProcessedDay: Date | null;
}): Promise<DayInfo[]> {
  const periodFirstDay = dayBounds(edition.periodStart).periodStart;
  const periodLastDay = dayBounds(new Date(edition.periodEnd.getTime() - 1)).periodStart;
  const today = dayBounds(new Date()).periodStart;

  const days: Date[] = [];
  for (
    let cursor = periodFirstDay;
    cursor.getTime() <= periodLastDay.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    days.push(cursor);
  }

  // Which days actually hold data — the evidence `computeDayStatus` needs.
  // One query for the whole period, timestamps only, bucketed in memory: the
  // alternative is a count per square, and SQLite has no date-truncating
  // `groupBy` Prisma can drive.
  const [timestamps, runs] = await Promise.all([
    prisma.serviceActivity.findMany({
      where: { editionId: edition.id, timestamp: { gte: periodFirstDay, lt: edition.periodEnd } },
      select: { timestamp: true },
    }),
    // Recorded attempts, which only the manual per-day route writes — one
    // indexed lookup for the whole edition, bucketed by date like the above.
    prisma.dayProcessingRun.findMany({
      where: { editionId: edition.id },
      select: { date: true, status: true, hadActivity: true, error: true },
    }),
  ]);
  const daysWithActivity = new Set(
    timestamps.map((row) => row.timestamp?.toISOString().slice(0, 10)).filter(Boolean),
  );
  const runsByDay = new Map(runs.map((run) => [run.date.toISOString().slice(0, 10), run]));

  return days.map((day) => {
    const dateStr = day.toISOString().slice(0, 10);
    const base = computeDayStatus({
      dayStart: day,
      lastProcessedDay: edition.lastProcessedDay,
      hasActivity: daysWithActivity.has(dateStr),
      today,
    });
    return { date: day, dateStr, ...foldDayRun(base, runsByDay.get(dateStr)) };
  });
}
