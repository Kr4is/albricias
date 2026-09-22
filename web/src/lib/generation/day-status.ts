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

/**
 * - `processed` — this day really was processed (evidence, see below).
 * - `skipped` — a day already over that was never processed and never will be
 *   automatically. Daily processing does not backfill.
 * - `today` — the current UTC day: in progress, not yet due.
 * - `pending` — not yet due: a future day, or yesterday before the daily cron
 *   has reached it.
 */
export type DayStatus = "processed" | "skipped" | "today" | "pending";

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
  skipped: "Never processed",
  today: "Today",
  pending: "Pending",
};

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
