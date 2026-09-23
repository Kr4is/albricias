/**
 * Shared shapes for the GitHub activity source.
 */

/** Value of `ActivityItem.source`. */
export type ActivitySource = "github";

/** One normalised GitHub event. */
export interface ActivityItem {
  source: ActivitySource;
  /** `commit` | `pr` | `review` | `issue` | `release` | `repo_created` | `gist` | `star`. */
  eventType: string;
  /** `owner/name` for repo-scoped events; `null` otherwise. */
  repo: string | null;
  title: string;
  url: string | null;
  timestamp: Date | null;
  /** Original API payload, stored verbatim for later re-processing. */
  raw: unknown;
}

/** A half-open period `[periodStart, periodEnd)`. */
export interface Period {
  periodStart: Date;
  periodEnd: Date;
}

/** `true` when `date` falls inside the half-open period. */
export function inPeriod(date: Date | null, period: Period): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= period.periodStart.getTime() && t < period.periodEnd.getTime();
}

/** `true` when `date` is strictly before the period — used for early-exit. */
export function beforePeriod(date: Date | null, period: Period): boolean {
  return date !== null && date.getTime() < period.periodStart.getTime();
}

/** Lenient ISO-8601 parse; returns `null` for missing/unparseable input. */
export function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
}
