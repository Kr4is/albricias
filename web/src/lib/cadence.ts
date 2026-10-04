/**
 * Period bounds and volume numbers for weekly/monthly/quarterly editions.
 *
 * `isoWeekPeriodBounds` is kept consistent with `isoWeek`/`editionWeather` in
 * `edition-helpers.ts` so the two files agree on what a "week" is.
 */

import { type Cadence, type EditionPeriod, isoWeek, quarterOf } from "@/lib/edition-helpers";

interface PeriodBounds {
  periodStart: Date;
  periodEnd: Date;
}

/** `months` calendar months from `[first of month, +months)`, UTC. */
function monthsBounds(year: number, month: number, months: number): PeriodBounds {
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    periodEnd: new Date(Date.UTC(year, month - 1 + months, 1)),
  };
}

/** ISO-week bounds: `[Monday 00:00 UTC, next Monday)` for week-numbering `year`/`week`. */
function isoWeekPeriodBounds(year: number, week: number): PeriodBounds {
  // ISO week 1 is the week containing the year's first Thursday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Weekday);

  const periodStart = new Date(week1Monday);
  periodStart.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodStart.getUTCDate() + 7);
  return { periodStart, periodEnd };
}

/** Bounds of the period of `cadence` containing `date`. */
function periodBoundsForDate(cadence: Cadence, date: Date): PeriodBounds {
  const year = date.getUTCFullYear();
  if (cadence === "weekly") {
    const { year: weekYear, week } = isoWeek(date);
    return isoWeekPeriodBounds(weekYear, week);
  }
  if (cadence === "quarterly") return monthsBounds(year, (quarterOf(date) - 1) * 3 + 1, 3);
  return monthsBounds(year, date.getUTCMonth() + 1, 1);
}

/**
 * The masthead's volume line.
 * Weekly: `"VOL. 2026 NO. W10"`. Monthly: `"VOL. 2026 NO. 3"`. Quarterly: `"VOL. 2026 NO. Q1"`.
 */
export function defaultEditionVol(period: EditionPeriod): string {
  if (period.cadence === "weekly") {
    const { year, week } = isoWeek(period.periodStart);
    return `VOL. ${year} NO. W${week}`;
  }
  const year = period.periodStart.getUTCFullYear();
  if (period.cadence === "quarterly") return `VOL. ${year} NO. Q${quarterOf(period.periodStart)}`;
  return `VOL. ${year} NO. ${period.periodStart.getUTCMonth() + 1}`;
}

/**
 * The period an edition requested `now` covers: the last *complete* week,
 * month or quarter. The current one is always part-way through — on the 4th
 * a "monthly" edition would have four days to report on.
 */
export function editionBounds(cadence: Cadence, now: Date = new Date()): PeriodBounds {
  const { periodStart: currentStart } = periodBoundsForDate(cadence, now);
  // One millisecond before the current period began lies in the previous one.
  return periodBoundsForDate(cadence, new Date(currentStart.getTime() - 1));
}
