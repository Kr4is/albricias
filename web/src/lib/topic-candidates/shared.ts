/**
 * Small helpers shared by more than one detector. Anything used by exactly one
 * detector lives with that detector instead — the same rule
 * `src/lib/github-stats/shared.ts` follows.
 */

import type { GithubStats } from "@/lib/github-stats";

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Commits + PRs + issues + releases — the same definition `summarisePeriod` in
 * `@/lib/github-stats` uses for a period's size.
 *
 * Reused here rather than re-derived so a candidate's "N% of the period" bullet
 * and the stats bank's own trend figures are quoting the same total; two
 * different notions of "the period's work" in one edition would be indefensible
 * to anyone checking the numbers by hand.
 */
export function totalContributions(stats: GithubStats): number {
  const { totalCommits, totalPrs, totalIssues, totalReleases } = stats.volume;
  return totalCommits + totalPrs + totalIssues + totalReleases;
}

/** `3` → `"3 pull requests"`, `1` → `"1 pull request"`. */
export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** A share as a whole-ish percentage for prose — one decimal, trailing `.0` dropped. */
export function percent(share: number): string {
  return String(Math.round(share * 1000) / 10);
}

/**
 * Up to `limit` names, the rest folded into "and N more".
 *
 * Bullets are read by a human choosing a topic, so a candidate backed by
 * fifteen repos should say so in one line rather than printing all fifteen.
 */
export function nameList(names: string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${count(names.length - limit, "other")}`;
}
