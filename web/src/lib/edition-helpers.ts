/**
 * Pure helpers for Edition period labels and the deterministic pseudo-weather
 * string, ported from `app/models/edition.py:58-96` and generalised from
 * (month, year) to (cadence, periodStart).
 *
 * The monthly seeding key is intentionally identical to Flask's
 * `f"{self.year}-{self.month}"`, so editions migrated in Phase 5 keep rendering
 * exactly the same weather line they render today.
 */

import { createHash } from "node:crypto";

export const CADENCE_WEEKLY = "weekly";
export const CADENCE_MONTHLY = "monthly";

export type Cadence = typeof CADENCE_WEEKLY | typeof CADENCE_MONTHLY;

export const EDITION_STATUS_DRAFT = "draft";
export const EDITION_STATUS_PUBLISHED = "published";

/** Minimal shape needed by these helpers — any Edition row satisfies it. */
export interface EditionPeriod {
  cadence: string;
  periodStart: Date;
  periodEnd: Date;
}

/** Seasonal band: base temperature and the condition list to pick from. */
interface SeasonBand {
  baseTemp: number;
  conditions: readonly string[];
}

// Same bands and condition lists as `app/models/edition.py:86-93`, keyed by the
// 1-12 month number of the period's start date.
const SEASON_BANDS: readonly SeasonBand[] = [
  { baseTemp: 2, conditions: ["Snowy", "Frigid", "Clear", "Overcast"] }, // Dec/Jan/Feb
  { baseTemp: 15, conditions: ["Rainy", "Cloudy", "Breezy", "Mild"] }, // Mar/Apr/May
  { baseTemp: 28, conditions: ["Sunny", "Hot", "Humid", "Clear"] }, // Jun/Jul/Aug
  { baseTemp: 12, conditions: ["Windy", "Rainy", "Crisp", "Foggy"] }, // Sep/Oct/Nov
];

function seasonBand(month: number): SeasonBand {
  if (month === 12 || month === 1 || month === 2) return SEASON_BANDS[0];
  if (month >= 3 && month <= 5) return SEASON_BANDS[1];
  if (month >= 6 && month <= 8) return SEASON_BANDS[2];
  return SEASON_BANDS[3];
}

/**
 * ISO-8601 week number and week-numbering year for a UTC date.
 * Used to build a stable key for weekly editions.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  // Shift to the Thursday of the same ISO week; its calendar year is the
  // ISO week-numbering year.
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayOfWeek = (thursday.getUTCDay() + 6) % 7; // Monday = 0
  thursday.setUTCDate(thursday.getUTCDate() - dayOfWeek + 3);

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / msPerWeek);

  return { year: thursday.getUTCFullYear(), week };
}

/**
 * The string fed into the weather hash.
 *
 * Monthly editions use `"<year>-<month>"` with an unpadded month, byte-identical
 * to the Flask implementation, so historical editions keep their weather.
 */
export function periodKey(edition: EditionPeriod): string {
  const start = edition.periodStart;
  if (edition.cadence === CADENCE_WEEKLY) {
    const { year, week } = isoWeek(start);
    return `${year}-W${week}`;
  }
  return `${start.getUTCFullYear()}-${start.getUTCMonth() + 1}`;
}

/** Exported for the admin period-picker forms (month select options). */
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Human-readable period label.
 *
 * Monthly: `"March 2026"` — identical to `Edition.date` in Flask.
 * Weekly:  `"Week of March 3, 2026"`.
 */
export function periodLabel(edition: EditionPeriod): string {
  const start = edition.periodStart;
  const month = MONTHS_LONG[start.getUTCMonth()];
  const year = start.getUTCFullYear();

  if (edition.cadence === CADENCE_WEEKLY) {
    return `Week of ${month} ${start.getUTCDate()}, ${year}`;
  }
  return `${month} ${year}`;
}

/**
 * Short period label.
 *
 * Monthly: `"Mar 2026"` — identical to `Edition.date_short` in Flask.
 * Weekly:  `"Mar 3–9, 2026"` (end date is the inclusive last day of the period).
 */
export function periodLabelShort(edition: EditionPeriod): string {
  const start = edition.periodStart;
  const startMonth = MONTHS_SHORT[start.getUTCMonth()];
  const year = start.getUTCFullYear();

  if (edition.cadence !== CADENCE_WEEKLY) {
    return `${startMonth} ${year}`;
  }

  // periodEnd is exclusive; step back one day for a human-facing range.
  const lastDay = new Date(edition.periodEnd.getTime() - 24 * 60 * 60 * 1000);
  const endMonth = MONTHS_SHORT[lastDay.getUTCMonth()];

  if (endMonth === startMonth && lastDay.getUTCFullYear() === year) {
    return `${startMonth} ${start.getUTCDate()}–${lastDay.getUTCDate()}, ${year}`;
  }
  return `${startMonth} ${start.getUTCDate()} – ${endMonth} ${lastDay.getUTCDate()}, ${lastDay.getUTCFullYear()}`;
}

/**
 * Deterministic pseudo-weather string, e.g. `"Rainy, 17°C"`.
 *
 * Same algorithm as `app/models/edition.py:76-96`: take sha256 of the period
 * key as a big integer mod 100, then derive temperature and condition from the
 * season of the period's start month.
 */
export function editionWeather(edition: EditionPeriod): string {
  const digest = createHash("sha256").update(periodKey(edition)).digest("hex");
  // Python: int(hexdigest, 16) % 100 — needs BigInt to match exactly.
  const seed = Number(BigInt(`0x${digest}`) % 100n);

  const { baseTemp, conditions } = seasonBand(edition.periodStart.getUTCMonth() + 1);
  const temp = baseTemp + (seed % 11) - 5;
  const condition = conditions[seed % conditions.length];

  return `${condition}, ${temp}°C`;
}

/** Ported from `Edition.is_published`. */
export function isPublished(edition: { status: string }): boolean {
  return edition.status === EDITION_STATUS_PUBLISHED;
}
