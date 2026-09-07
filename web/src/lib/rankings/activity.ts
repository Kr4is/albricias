/**
 * Activity / productivity ranking — Phase C, ranking type #1.
 *
 * Pure-TypeScript computation over a period's `ServiceActivity` GitHub rows
 * (busiest day(s), event-type breakdown) plus one extra GitHub fetch per
 * touched repo for language data (`GET /repos/{owner}/{repo}/languages`,
 * cached per-repo for the run so the same repo is never fetched twice), then
 * one LLM call — via the existing `chronicleAgent`/`runNewspaperAgent`
 * plumbing, same shape as `regenerateArticle` in `@/lib/generation` — to
 * narrate the numbers as a newspaper article in the `NEWSPAPER_PERSONA`
 * voice.
 *
 * {@link createActivityRankingArticle} is the single entry point: it returns
 * `null` (not an error) when there is no GitHub activity to rank for the
 * edition, per the plan's "skip gracefully" requirement for the automatic
 * pipeline. Per-repo language-fetch failures (rate limit, deleted repo, etc.)
 * are logged and skipped — matching this codebase's established per-source
 * graceful-degradation pattern (see `runEditionGeneration` in
 * `@/lib/generation/index.ts`) — never failing the whole ranking.
 */

import { Octokit } from "octokit";
import type { Article } from "@/generated/prisma/client";
import { getSetting } from "@/lib/config/settings";
import { periodLabel } from "@/lib/edition-helpers";
import { prisma } from "@/lib/prisma";
import { chronicleAgent, MODEL_NAME, parseResponse, runNewspaperAgent } from "@/mastra/agents";
import type { GeneratorResult } from "@/mastra/schemas";
import { RANKING_CATEGORY, persistRankingArticle } from "./shared";

/** Reduced view of a `ServiceActivity` row this module needs. */
export interface ActivityRankingRow {
  eventType: string;
  repo: string | null;
  timestamp: Date | null;
}

export interface DayCount {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  count: number;
}

export interface EventTypeCount {
  eventType: string;
  count: number;
}

export interface LanguageBytes {
  language: string;
  bytes: number;
}

export interface ActivityRankingComputation {
  totalEvents: number;
  /** Every day with at least one event, sorted busiest-first (date ascending on ties). */
  dayCounts: DayCount[];
  /** The subset of `dayCounts` tied at the maximum count — "busiest day(s)". */
  busiestDays: DayCount[];
  /** Sorted busiest-first (event type ascending on ties). */
  eventTypeBreakdown: EventTypeCount[];
  /** Distinct `owner/repo` names touched this period, for the language fetch. */
  touchedRepos: string[];
}

/** `YYYY-MM-DD` in UTC, matching the convention `@/lib/sources/github.ts` uses for period boundaries. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Bucket a period's GitHub `ServiceActivity` rows into busiest-day and
 * event-type breakdowns, and collect the distinct repos touched.
 */
export function computeActivityRanking(rows: ActivityRankingRow[]): ActivityRankingComputation {
  const dayMap = new Map<string, number>();
  const eventTypeMap = new Map<string, number>();
  const repos = new Set<string>();

  for (const row of rows) {
    eventTypeMap.set(row.eventType, (eventTypeMap.get(row.eventType) ?? 0) + 1);
    if (row.repo) repos.add(row.repo);
    if (row.timestamp) {
      const key = dayKey(row.timestamp);
      dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    }
  }

  const dayCounts = [...dayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
  const maxCount = dayCounts[0]?.count ?? 0;
  const busiestDays = dayCounts.filter((d) => d.count === maxCount && maxCount > 0);

  const eventTypeBreakdown = [...eventTypeMap.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType));

  return {
    totalEvents: rows.length,
    dayCounts,
    busiestDays,
    eventTypeBreakdown,
    touchedRepos: [...repos].sort(),
  };
}

/**
 * Bound the number of extra GitHub API calls a single ranking run can make —
 * the plan's own risk note ("N extra API calls per generation") asked for a
 * cap; 15 comfortably covers a normal period's touched-repo count while
 * keeping worst case bounded.
 */
const MAX_LANGUAGE_FETCHES = 15;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch each repo's language breakdown via `GET /repos/{owner}/{repo}/languages`,
 * caching per-repo results in `cache` so a repeated repo is never refetched
 * within the same run. A failing repo (rate limit, 404, etc.) is logged and
 * cached as empty — skipped, never thrown — so one bad repo can't fail the
 * whole ranking.
 */
export async function fetchRepoLanguages(
  octokit: Octokit,
  repos: string[],
  cache: Map<string, Record<string, number>> = new Map(),
): Promise<Map<string, Record<string, number>>> {
  for (const repoName of repos.slice(0, MAX_LANGUAGE_FETCHES)) {
    if (cache.has(repoName)) continue;
    const [owner, repo] = repoName.split("/");
    if (!owner || !repo) continue;
    try {
      const response = await octokit.request("GET /repos/{owner}/{repo}/languages", {
        owner,
        repo,
      });
      cache.set(repoName, response.data as Record<string, number>);
    } catch (error) {
      console.error(`[rankings] Language fetch failed for ${repoName}: ${describe(error)}`);
      cache.set(repoName, {});
    }
  }
  return cache;
}

/** Sum per-repo language bytes into a single period-wide breakdown, busiest-first, top 8. */
export function aggregateLanguages(perRepo: Map<string, Record<string, number>>): LanguageBytes[] {
  const totals = new Map<string, number>();
  for (const languages of perRepo.values()) {
    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) ?? 0) + bytes);
    }
  }
  return [...totals.entries()]
    .map(([language, bytes]) => ({ language, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
}

function buildActivityRankingPrompt(
  label: string,
  computation: ActivityRankingComputation,
  languages: LanguageBytes[],
): string {
  const breakdown = computation.eventTypeBreakdown
    .map((e) => `${e.eventType}: ${e.count}`)
    .join(", ");
  const busiest = computation.busiestDays.map((d) => `${d.date} (${d.count} events)`).join(", ");
  const langLine =
    languages.length > 0 ? languages.map((l) => l.language).join(", ") : "not available this period";

  return (
    `Write a newspaper article for the 'Rankings' section of the ${label} edition ` +
    `of ¡Albricias!, an activity & productivity report on the correspondent's ` +
    `open-source labour this period.\n\n` +
    `Report on the busiest day(s) of the period, the balance of commits vs pull ` +
    `requests vs reviews vs issues vs releases vs new repositories vs starred ` +
    `repositories vs other activity, and the most-used programming languages, as a ` +
    `droll productivity almanac — think a vintage newspaper's statistics column, ` +
    `part boast, part diary.\n\n` +
    `Data:\n` +
    `- Total events: ${computation.totalEvents}\n` +
    `- Busiest day(s): ${busiest || "none recorded"}\n` +
    `- Event-type breakdown: ${breakdown || "none"}\n` +
    `- Repositories touched: ${computation.touchedRepos.join(", ") || "none"}\n` +
    `- Most-used languages (by bytes across touched repos): ${langLine}\n\n` +
    `Give the article a compelling headline (as a markdown H1), then the body text. ` +
    `Do not include a byline or date — those are added separately. Do not fabricate ` +
    `numbers beyond what is given above.`
  );
}

export interface ActivityRankingInput {
  periodLabel: string;
  computation: ActivityRankingComputation;
  languages: LanguageBytes[];
}

/** One LLM call, in the `NEWSPAPER_PERSONA` voice, narrating the raw ranking numbers. */
export async function narrateActivityRanking(
  input: ActivityRankingInput,
  apiKey?: string,
): Promise<GeneratorResult> {
  const prompt = buildActivityRankingPrompt(input.periodLabel, input.computation, input.languages);
  const raw = await runNewspaperAgent(chronicleAgent, { user: prompt, apiKey });
  const { title, content } = parseResponse(raw, `Activity Report — ${input.periodLabel}`);
  return {
    title,
    content,
    category: RANKING_CATEGORY,
    sourceData: {
      generator: "activity-ranking",
      prompt,
      response: raw,
      model: MODEL_NAME,
      computation: input.computation,
      languages: input.languages,
    },
  };
}

/**
 * Compute and narrate the activity ranking for `editionId`, persisting it as
 * an `Article`. Returns `null` — not an error — when the edition has no
 * GitHub-sourced `ServiceActivity` rows, so callers (the automatic pipeline,
 * or an admin action) can skip gracefully with no article.
 */
export async function createActivityRankingArticle(
  editionId: number,
  apiKey?: string,
): Promise<Article | null> {
  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  if (!edition) throw new Error(`Edition ${editionId} not found.`);

  const rows = await prisma.serviceActivity.findMany({
    where: { editionId, source: "github" },
    select: { eventType: true, repo: true, timestamp: true },
  });
  if (rows.length === 0) return null;

  const computation = computeActivityRanking(rows);

  let languages: LanguageBytes[] = [];
  const githubToken = await getSetting("integrations.github.token", { encrypted: true });
  if (githubToken && computation.touchedRepos.length > 0) {
    try {
      const octokit = new Octokit({ auth: githubToken });
      const perRepo = await fetchRepoLanguages(octokit, computation.touchedRepos);
      languages = aggregateLanguages(perRepo);
    } catch (error) {
      // fetchRepoLanguages already isolates per-repo failures; this only
      // guards against something failing before the per-repo loop even
      // starts (e.g. Octokit construction) — still non-fatal to the ranking.
      console.error(`[rankings] Language fetch aborted: ${describe(error)}`);
    }
  }

  const label = periodLabel(edition);
  const result = await narrateActivityRanking({ periodLabel: label, computation, languages }, apiKey);
  return persistRankingArticle(editionId, result, edition.periodStart);
}
