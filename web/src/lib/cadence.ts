/**
 * Global cadence setting and period-bounds computation for the admin
 * "new edition" / "generate edition" / "compose" flows.
 *
 * The `Setting` row (`key = "cadence"`) decides whether new editions are
 * weekly or monthly (`app/routes/admin.py` had no equivalent — this is new
 * in the rewrite, per the plan). `monthPeriodBounds` reproduces the original
 * month/year picker's math; `isoWeekPeriodBounds` generalises it to an ISO
 * week, kept consistent with `isoWeek`/`periodKey`/`editionWeather` in
 * `edition-helpers.ts` so the two files agree on what a "week" is.
 */

import { prisma } from "@/lib/prisma";
import {
  CADENCE_MONTHLY,
  CADENCE_WEEKLY,
  type Cadence,
  type EditionPeriod,
  isoWeek,
  periodLabel,
} from "@/lib/edition-helpers";

const CADENCE_SETTING_KEY = "cadence";

/** Read the global cadence setting, defaulting to "monthly" when unset. */
export async function getCadence(): Promise<Cadence> {
  const row = await prisma.setting.findUnique({ where: { key: CADENCE_SETTING_KEY } });
  return row?.value === CADENCE_WEEKLY ? CADENCE_WEEKLY : CADENCE_MONTHLY;
}

/** Persist the global cadence setting. */
export async function setCadence(cadence: Cadence): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CADENCE_SETTING_KEY },
    create: { key: CADENCE_SETTING_KEY, value: cadence },
    update: { value: cadence },
  });
}

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

/** `Edition.title` for a not-yet-created edition — identical to `periodLabel`. */
export function defaultEditionTitle(period: EditionPeriod): string {
  return periodLabel(period);
}

/**
 * `Edition.vol` for a not-yet-created edition.
 * Monthly: `"VOL. 2026 NO. 3"` — identical to Python's `f"VOL. {year} NO. {month}"`.
 * Weekly: `"VOL. 2026 NO. W10"`.
 */
export function defaultEditionVol(period: EditionPeriod): string {
  if (period.cadence === CADENCE_WEEKLY) {
    const { year, week } = isoWeek(period.periodStart);
    return `VOL. ${year} NO. W${week}`;
  }
  const year = period.periodStart.getUTCFullYear();
  const month = period.periodStart.getUTCMonth() + 1;
  return `VOL. ${year} NO. ${month}`;
}

/** `<input type="week">` value, e.g. `"2026-W10"`. */
export function toWeekInputValue({ year, week }: { year: number; week: number }): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Parse an `<input type="week">` value back into `{ year, week }`, or `null` if malformed. */
export function parseWeekInputValue(
  value: string | null | undefined,
): { year: number; week: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const week = Number.parseInt(match[2], 10);
  if (week < 1 || week > 53) return null;
  return { year, week };
}

/**
 * Resolve the `[periodStart, periodEnd)` an admin period-picker form
 * submitted, under `cadence` — a "week" field when weekly, "month" + "year"
 * fields when monthly (see `PeriodPickerFields`). Throws on missing/invalid
 * input; callers redirect back with a flash error.
 */
export function resolvePeriodFromForm(form: FormData, cadence: Cadence): PeriodBounds {
  if (cadence === CADENCE_WEEKLY) {
    const parsed = parseWeekInputValue(form.get("week")?.toString());
    if (!parsed) throw new Error("Invalid week.");
    return isoWeekPeriodBounds(parsed.year, parsed.week);
  }
  const month = Number.parseInt(form.get("month")?.toString() ?? "", 10);
  const year = Number.parseInt(form.get("year")?.toString() ?? "", 10);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    throw new Error("Invalid month or year.");
  }
  return monthPeriodBounds(year, month);
}
