/**
 * The GitHub stats bank — phase 1 of
 * `.omc/plans/github-monthly-stats-extraction.md`.
 *
 * Computes 20-odd metrics about one edition's GitHub period (busiest day,
 * longest streak, PR lifetimes, commit-message texture, most-used language,
 * trend against previous periods) and returns them as the object stored in
 * `Edition.githubStats`, whose doc comment in `prisma/schema.prisma` is the
 * authority on the shape. A *later* phase picks a few of these to narrate each
 * period; nothing here decides what is interesting, only what is true.
 *
 * Almost all of it is arithmetic over `ServiceActivity` rows the generation
 * pipeline has already saved, so it costs nothing and — unlike article
 * generation — does not depend on an AI provider being configured. The single
 * exception is the language group's bounded per-repo fetch, which reuses
 * `@/lib/rankings/activity`'s existing capped-and-cached helper.
 *
 * {@link computeGithubStats} never throws: it is called from
 * `populateEditionDraft`, where every optional source degrades rather than
 * aborting the run. Missing settings, malformed `rawJson`, an unreachable
 * GitHub — each costs at most the metrics that depend on it.
 */

import { CADENCE_MONTHLY, CADENCE_WEEKLY, type Cadence } from "@/lib/edition-helpers";
import { type GetSettingOptions, getSetting } from "@/lib/config/settings";
import { prisma } from "@/lib/prisma";
import { computeCollaborationStats } from "./collaboration";
import { computeContentStats } from "./content";
import { computeLanguageStats } from "./language";
import { describe } from "./shared";
import { computeTemporalStats } from "./temporal";
import { computeTrendStats, parseStoredSummary, summarisePeriod } from "./trend";
import { computeVolumeStats, touchedRepos } from "./volume";
import type { GithubStats, GithubStatsRow, PeriodSummary } from "./types";

/**
 * How far back the trend group looks. A year of monthly editions is enough for
 * every comparison it makes ("best period this year" can't reach further, and
 * a streak longer than this is already a superlative), while keeping the query
 * bounded no matter how long the paper has been running.
 */
const MAX_PRIOR_PERIODS = 12;

/**
 * Compute the full stats bank for `editionId`.
 *
 * Returns `null` — never an empty shape — when the edition has no GitHub
 * activity at all. That distinction is load-bearing downstream: the trend
 * group reads a stored `null` as "that period was silent", so writing zeroes
 * for a period GitHub was simply not configured for would invent an inactive
 * period that never happened.
 */
export async function computeGithubStats(editionId: number): Promise<GithubStats | null> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { id: true, cadence: true, periodStart: true },
  });
  if (!edition) return null;

  const rows: GithubStatsRow[] = await prisma.serviceActivity.findMany({
    where: { editionId, source: "github" },
    select: { eventType: true, repo: true, title: true, timestamp: true, rawJson: true },
  });
  if (rows.length === 0) return null;

  const [username, token] = await Promise.all([
    readSetting("integrations.github.username"),
    readSetting("integrations.github.token", { encrypted: true }),
  ]);

  const volume = computeVolumeStats(rows);
  const stats: GithubStats = {
    temporal: computeTemporalStats(rows),
    volume,
    collaboration: computeCollaborationStats(rows, username),
    content: computeContentStats(rows),
    language: await computeLanguageStats(touchedRepos(rows), token),
    trend: null,
  };

  const priors = await loadPriorSummaries(edition.id, edition.cadence, edition.periodStart);
  stats.trend = computeTrendStats(
    summarisePeriod(edition.periodStart, stats),
    priors,
    normaliseCadence(edition.cadence),
  );

  return stats;
}

/** `Edition.cadence` is a free-form column; anything that isn't "weekly" is monthly, as everywhere else. */
function normaliseCadence(cadence: string): Cadence {
  return cadence === CADENCE_WEEKLY ? CADENCE_WEEKLY : CADENCE_MONTHLY;
}

/** A settings read that degrades to "unset" — a broken `Setting` row shouldn't cost the whole bank. */
async function readSetting(
  key: string,
  opts: GetSettingOptions = {},
): Promise<string | undefined> {
  try {
    return await getSetting(key, opts);
  } catch (error) {
    console.error(`[github-stats] Setting ${key} unreadable: ${describe(error)}`);
    return undefined;
  }
}

/**
 * Earlier same-cadence editions that already have a stored stats bank, newest
 * first. Cadence is part of the filter because a weekly period and a monthly
 * one aren't comparable quantities — trending 400 monthly commits against last
 * week's 90 would be nonsense.
 */
async function loadPriorSummaries(
  editionId: number,
  cadence: string,
  periodStart: Date,
): Promise<PeriodSummary[]> {
  try {
    const editions = await prisma.edition.findMany({
      where: {
        id: { not: editionId },
        cadence,
        periodStart: { lt: periodStart },
        githubStats: { not: null },
      },
      orderBy: { periodStart: "desc" },
      take: MAX_PRIOR_PERIODS,
      select: { periodStart: true, githubStats: true },
    });
    return editions
      .map((e) => parseStoredSummary(e.periodStart, e.githubStats))
      .filter((summary): summary is PeriodSummary => summary !== null);
  } catch (error) {
    console.error(`[github-stats] Prior-period lookup failed: ${describe(error)}`);
    return [];
  }
}

export {
  type BestPeriod,
  type CollaborationStats,
  type ContentStats,
  type DayCount,
  type EmojiCount,
  type GithubStats,
  type GithubStatsRow,
  type HourCount,
  type KeywordCount,
  type LanguageBytes,
  type LanguageStats,
  type PeriodSummary,
  type RepoCount,
  type TemporalStats,
  type TimeOfDaySplit,
  type TrendComparison,
  type TrendStats,
  type VolumeStats,
  type WeekdayCount,
} from "./types";

export { computeCollaborationStats } from "./collaboration";
export { computeContentStats, conventionalType } from "./content";
export { computeLanguageStats } from "./language";
export { computeTemporalStats } from "./temporal";
export { computeTrendStats, parseStoredSummary, summarisePeriod } from "./trend";
export { computeVolumeStats, touchedRepos } from "./volume";
