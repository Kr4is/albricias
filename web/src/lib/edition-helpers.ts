/**
 * Pure helpers for an edition's period labels and its deterministic
 * pseudo-weather line (the same period always gets the same weather).
 */

import { createHash } from "node:crypto";

export const CADENCE_DAILY = "daily";
export const CADENCE_WEEKLY = "weekly";
export const CADENCE_MONTHLY = "monthly";

export type Cadence =
  | typeof CADENCE_DAILY
  | typeof CADENCE_WEEKLY
  | typeof CADENCE_MONTHLY;

/** Minimal shape needed by these helpers. */
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

// Keyed by the 1-12 month number of the period's start date.
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

/** The string fed into the weather hash — one per day, ISO week or month. */
function periodKey(edition: EditionPeriod): string {
  const start = edition.periodStart;
  if (edition.cadence === CADENCE_DAILY) {
    return `${start.getUTCFullYear()}-${start.getUTCMonth() + 1}-${start.getUTCDate()}`;
  }
  if (edition.cadence === CADENCE_WEEKLY) {
    const { year, week } = isoWeek(start);
    return `${year}-W${week}`;
  }
  return `${start.getUTCFullYear()}-${start.getUTCMonth() + 1}`;
}

const MONTHS_LONG = [
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

/**
 * Human-readable period label.
 *
 * Daily: `"March 3, 2026"`. Weekly: `"Week of March 3, 2026"`. Monthly: `"March 2026"`.
 */
export function periodLabel(edition: EditionPeriod): string {
  const start = edition.periodStart;
  const month = MONTHS_LONG[start.getUTCMonth()];
  const year = start.getUTCFullYear();

  if (edition.cadence === CADENCE_DAILY) {
    return `${month} ${start.getUTCDate()}, ${year}`;
  }
  if (edition.cadence === CADENCE_WEEKLY) {
    return `Week of ${month} ${start.getUTCDate()}, ${year}`;
  }
  return `${month} ${year}`;
}

/**
 * Deterministic pseudo-weather string, e.g. `"Rainy, 17°C"`.
 *
 * sha256 of the period key as a big integer mod 100, then temperature and
 * condition from the season of the period's start month.
 */
export function editionWeather(edition: EditionPeriod): string {
  const digest = createHash("sha256").update(periodKey(edition)).digest("hex");
  // The whole 256-bit digest mod 100 — BigInt, since it overflows a Number.
  const seed = Number(BigInt(`0x${digest}`) % 100n);

  const { baseTemp, conditions } = seasonBand(edition.periodStart.getUTCMonth() + 1);
  const temp = baseTemp + (seed % 11) - 5;
  const condition = conditions[seed % conditions.length];

  return `${condition}, ${temp}°C`;
}
