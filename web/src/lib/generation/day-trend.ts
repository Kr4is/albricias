/**
 * One day against the days before it — the day-scoped sibling of
 * `@/lib/github-stats/trend.ts`'s `computeTrendStats`, and deliberately the
 * same shape of thing: {@link computeDayTrend} is pure, taking the rolling
 * window's already-counted days as an argument rather than querying Prisma, so
 * the comparison arithmetic can be reasoned about without a database. The
 * `research-day` step of `@/mastra/workflows/day-post` does the querying.
 *
 * The convention that matters most is inherited verbatim from `trend.ts:69-72`:
 * with no prior day to compare against, this returns `null` rather than a
 * comparison against zero. A day-post is narrated from this, and an invented
 * "activity down 100%" on the first day ever processed would read as a real
 * finding instead of "there is no history yet".
 *
 * A prior day that was processed and genuinely had nothing is still a prior day
 * — pass it in with `totalEvents: 0`. That is what lets {@link computeDayTrend}
 * break an active run honestly, exactly as `countActiveRun` does over periods.
 */

import { MS_PER_DAY } from "@/lib/github-stats/shared";

/**
 * One day reduced to the quantities days are compared on — what the caller
 * counts from that day's `ServiceActivity` rows.
 *
 * `date` is the day's UTC midnight as an ISO string (`Date.toISOString()`), the
 * same "dates travel as strings" convention `PeriodSummary.periodStart` uses, so
 * a summary can cross a workflow step boundary unchanged.
 */
export interface DaySummary {
  date: string;
  /** Every activity row that day, all event types — the day's overall volume. */
  totalEvents: number;
  /** Distinct repositories touched that day — breadth, where `totalEvents` is depth. */
  distinctRepos: number;
}

export interface DayComparison {
  direction: "up" | "down" | "flat";
  /** What `current` is being compared against: one day's events, or the window's mean. */
  referenceEvents: number;
  deltaEvents: number;
  /** `null` when the reference is 0 — a percentage against nothing is not a figure. */
  deltaPercent: number | null;
}

export interface DayTrend {
  /** Against the most recent day before this one that the caller supplied. */
  vsPreviousDay: DayComparison & { previousDate: string };
  /** Against the mean of every prior day supplied — the "typical day lately" figure. */
  vsRecentAverage: DayComparison & { days: number; averageEvents: number };
  /** Days in a row with activity, ending with (and counting) this one; 0 if today had none. */
  consecutiveActiveDays: number;
}

/**
 * Trend of `current` against `priorDays`.
 *
 * `priorDays` may arrive in any order, may contain days after `current` (they
 * are dropped), and may have gaps. Everything is derived from `date`, never
 * from array position. Returns `null` when nothing in `priorDays` actually
 * precedes `current`.
 */
export function computeDayTrend(current: DaySummary, priorDays: DaySummary[]): DayTrend | null {
  const currentDate = new Date(current.date);
  if (Number.isNaN(currentDate.getTime())) return null;

  const earlier = priorDays
    .filter((day) => {
      const date = new Date(day.date);
      return !Number.isNaN(date.getTime()) && date < currentDate;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  if (earlier.length === 0) return null;

  const average = earlier.reduce((sum, day) => sum + day.totalEvents, 0) / earlier.length;

  return {
    vsPreviousDay: {
      previousDate: earlier[0].date,
      ...compare(current.totalEvents, earlier[0].totalEvents),
    },
    vsRecentAverage: {
      days: earlier.length,
      // One decimal: a mean of counts is not itself a count, and printing
      // "4.333333333 events" in a source block invites the model to quote it.
      averageEvents: Math.round(average * 10) / 10,
      ...compare(current.totalEvents, average),
    },
    consecutiveActiveDays: countActiveRun(current, earlier),
  };
}

/** Same arithmetic (and same `deltaPercent` rounding) as `trend.ts`'s `compareToPrevious`. */
function compare(current: number, reference: number): DayComparison {
  const delta = current - reference;
  return {
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    referenceEvents: Math.round(reference * 10) / 10,
    deltaEvents: Math.round(delta * 10) / 10,
    deltaPercent: reference > 0 ? Math.round((delta / reference) * 1000) / 10 : null,
  };
}

/**
 * How many days in a row, ending with the current one, had any activity.
 *
 * Walks back one calendar day at a time: the run breaks at the first
 * immediately preceding day that is either absent from `earlier` (never
 * processed — nothing is known about it, so it cannot extend a run) or present
 * with zero events. Same walk as `trend.ts`'s `countActiveRun`, with a day as
 * the step instead of a cadence period.
 */
function countActiveRun(current: DaySummary, earlier: DaySummary[]): number {
  if (current.totalEvents === 0) return 0;

  const byDate = new Map(earlier.map((day) => [day.date, day]));
  let run = 1;
  let cursor = new Date(new Date(current.date).getTime() - MS_PER_DAY);

  for (;;) {
    const previous = byDate.get(cursor.toISOString());
    if (!previous || previous.totalEvents === 0) return run;
    run += 1;
    cursor = new Date(cursor.getTime() - MS_PER_DAY);
  }
}
