/**
 * Cross-period comparison — this period against the ones before it.
 *
 * {@link computeTrendStats} is pure by design: it takes prior periods'
 * already-parsed summaries as an argument rather than querying Prisma, so the
 * comparison arithmetic can be reasoned about (and, later, tested) without a
 * database. `./index.ts` does the querying.
 *
 * Prior periods are only ever those with a stored `githubStats`, which the
 * pipeline writes as `null` for a period with no GitHub activity at all. That
 * makes "no stored stats for the immediately preceding period" and "the
 * correspondent did nothing that period" the same observation, which is what
 * lets {@link computeTrendStats} measure a streak without needing to know
 * whether an `Edition` row exists for every period in between.
 */

import { CADENCE_WEEKLY, type Cadence } from "@/lib/edition-helpers";
import { MS_PER_DAY, parseJsonObject } from "./shared";
import type { BestPeriod, GithubStats, PeriodSummary, TrendComparison, TrendStats } from "./types";

const DAYS_PER_WEEK = 7;

/**
 * Total contributions of a stats object — the single quantity periods are
 * compared on.
 *
 * Sums the four volume totals rather than storing a separate "total" field, so
 * a stats object written by an older version of this module stays comparable
 * and there is no second number that can drift out of agreement with the
 * group it summarises.
 */
export function summarisePeriod(periodStart: Date, stats: GithubStats): PeriodSummary {
  const { totalCommits, totalPrs, totalIssues, totalReleases } = stats.volume;
  return {
    periodStart: periodStart.toISOString(),
    totalContributions: totalCommits + totalPrs + totalIssues + totalReleases,
  };
}

/**
 * Read a stored `Edition.githubStats` string into a comparable summary, or
 * `null` for anything unreadable — a hand-edited row, or a stats object
 * written before the `volume` group existed. A prior period that can't be
 * parsed is dropped from the comparison rather than counted as zero, which
 * would fabricate a streak break.
 */
export function parseStoredSummary(periodStart: Date, stored: string | null): PeriodSummary | null {
  const volume = parseJsonObject(stored)?.volume;
  if (typeof volume !== "object" || volume === null) return null;

  const totals = ["totalCommits", "totalPrs", "totalIssues", "totalReleases"].map((key) => {
    const value = (volume as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
  if (totals.some((value) => value === null)) return null;

  return {
    periodStart: periodStart.toISOString(),
    totalContributions: totals.reduce<number>((sum, value) => sum + (value ?? 0), 0),
  };
}

/**
 * Trend against the previous period, best period so far this calendar year,
 * and the run of consecutive active periods ending with this one.
 *
 * `priors` may arrive in any order and may contain periods from other years or
 * with gaps; everything is derived from `periodStart` and `cadence`, never
 * from array position. Returns `null` when there are no prior periods at all —
 * the first edition an admin ever generates has nothing to trend against, and
 * an all-zero comparison would read as "activity collapsed" rather than "no
 * history yet".
 */
export function computeTrendStats(
  current: PeriodSummary,
  priors: PeriodSummary[],
  cadence: Cadence,
): TrendStats | null {
  const currentStart = new Date(current.periodStart);
  if (Number.isNaN(currentStart.getTime())) return null;

  const earlier = priors
    .filter((p) => {
      const start = new Date(p.periodStart);
      return !Number.isNaN(start.getTime()) && start < currentStart;
    })
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  if (earlier.length === 0) return null;

  return {
    vsPreviousPeriod: compareToPrevious(current, earlier[0]),
    bestPeriodThisYear: bestPeriodOfYear(current, earlier, currentStart.getUTCFullYear()),
    consecutiveActivePeriods: countActiveRun(current, earlier, cadence),
  };
}

function compareToPrevious(current: PeriodSummary, previous: PeriodSummary): TrendComparison {
  const delta = current.totalContributions - previous.totalContributions;
  return {
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    previousPeriodStart: previous.periodStart,
    previousTotalContributions: previous.totalContributions,
    deltaContributions: delta,
    deltaPercent:
      previous.totalContributions > 0
        ? Math.round((delta / previous.totalContributions) * 1000) / 10
        : null,
  };
}

/**
 * Best period of `year`, current period included — a record month is still the
 * record when it is the one being generated, and flagging it as current is how
 * a later narration can say "a new high" instead of "the best was March".
 */
function bestPeriodOfYear(
  current: PeriodSummary,
  earlier: PeriodSummary[],
  year: number,
): BestPeriod | null {
  const candidates: BestPeriod[] = [
    { ...current, isCurrentPeriod: true },
    ...earlier
      .filter((p) => new Date(p.periodStart).getUTCFullYear() === year)
      .map((p) => ({ ...p, isCurrentPeriod: false })),
  ];

  return candidates.reduce((best, candidate) =>
    candidate.totalContributions > best.totalContributions ? candidate : best,
  );
}

/**
 * How many periods in a row, ending with the current one, had contributions.
 *
 * Walks backwards period by period: the run breaks at the first immediately
 * preceding period that either has no stored summary (nothing happened, so the
 * pipeline stored nothing) or has a stored summary of zero contributions.
 */
function countActiveRun(current: PeriodSummary, earlier: PeriodSummary[], cadence: Cadence): number {
  if (current.totalContributions === 0) return 0;

  const byStart = new Map(earlier.map((p) => [p.periodStart, p]));
  let run = 1;
  let cursor = precedingPeriodStart(new Date(current.periodStart), cadence);

  for (;;) {
    const previous = byStart.get(cursor.toISOString());
    if (!previous || previous.totalContributions === 0) return run;
    run += 1;
    cursor = precedingPeriodStart(cursor, cadence);
  }
}

/**
 * Start of the period immediately before `start`, matching how
 * `monthPeriodBounds` / `isoWeekPeriodBounds` in `@/lib/cadence` lay periods
 * out: months step by calendar month (so February's length doesn't matter),
 * weeks by exactly seven days.
 */
function precedingPeriodStart(start: Date, cadence: Cadence): Date {
  if (cadence === CADENCE_WEEKLY) {
    return new Date(start.getTime() - DAYS_PER_WEEK * MS_PER_DAY);
  }
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
}
