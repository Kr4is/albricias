/**
 * Period-bounds computation for daily/weekly/monthly generation.
 *
 * `isoWeekPeriodBounds` is kept consistent with `isoWeek`/`editionWeather` in
 * `edition-helpers.ts` so the two files agree on what a "week" is.
 */

import {
  CADENCE_DAILY,
  CADENCE_WEEKLY,
  type Cadence,
  type EditionPeriod,
  isoWeek,
  periodLabel,
} from "@/lib/edition-helpers";

export interface PeriodBounds {
  periodStart: Date;
  periodEnd: Date;
}

/** Calendar-month bounds: `[first of month, first of next month)`, UTC. */
export function monthPeriodBounds(year: number, month: number): PeriodBounds {
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    periodEnd: new Date(Date.UTC(year, month, 1)),
  };
}

/** ISO-week bounds: `[Monday 00:00 UTC, next Monday)` for week-numbering `year`/`week`. */
export function isoWeekPeriodBounds(year: number, week: number): PeriodBounds {
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

/** Bounds of the single UTC calendar day containing `date` — `[00:00 UTC that day, 00:00 UTC the next day)`. */
export function dayBounds(date: Date): PeriodBounds {
  const periodStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodStart.getUTCDate() + 1);
  return { periodStart, periodEnd };
}

/** Bounds of the period containing `date`, under `cadence`. */
export function periodBoundsForDate(cadence: Cadence, date: Date): PeriodBounds {
  if (cadence === CADENCE_WEEKLY) {
    const { year, week } = isoWeek(date);
    return isoWeekPeriodBounds(year, week);
  }
  return monthPeriodBounds(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/** Bounds of the current period ("now"), under `cadence`. */
export function currentPeriodBounds(cadence: Cadence): PeriodBounds {
  return periodBoundsForDate(cadence, new Date());
}

/** `Edition.title` equivalent for a not-yet-created edition — identical to `periodLabel`. */
export function defaultEditionTitle(period: EditionPeriod): string {
  return periodLabel(period);
}

/**
 * `Edition.vol` equivalent for a not-yet-created edition.
 * Monthly: `"VOL. 2026 NO. 3"`. Weekly: `"VOL. 2026 NO. W10"`.
 */
export function defaultEditionVol(period: EditionPeriod): string {
  if (period.cadence === CADENCE_DAILY) {
    const { periodStart } = period;
    const dayOfYear = Math.floor(
      (Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()) -
        Date.UTC(periodStart.getUTCFullYear(), 0, 1)) /
        86_400_000,
    ) + 1;
    return `VOL. ${periodStart.getUTCFullYear()} NO. ${dayOfYear}`;
  }
  if (period.cadence === CADENCE_WEEKLY) {
    const { year, week } = isoWeek(period.periodStart);
    return `VOL. ${year} NO. W${week}`;
  }
  const year = period.periodStart.getUTCFullYear();
  const month = period.periodStart.getUTCMonth() + 1;
  return `VOL. ${year} NO. ${month}`;
}
