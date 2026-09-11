/**
 * Language metric — the one group in this bank that talks to GitHub.
 *
 * Deliberately a thin wrapper: `fetchRepoLanguages` / `aggregateLanguages` in
 * `@/lib/rankings/activity` already implement the per-repo fetch, the in-run
 * cache, the 15-repo cap and the log-and-skip error handling, and the activity
 * ranking article narrates their output for the same period. Reimplementing
 * any of that here would let this bank and that article disagree about the
 * correspondent's most-used language — the plan's verification step explicitly
 * cross-checks the two.
 */

import { Octokit } from "octokit";

import { aggregateLanguages, fetchRepoLanguages } from "@/lib/rankings/activity";
import { describe } from "./shared";
import type { LanguageStats } from "./types";

/**
 * Byte-weighted language breakdown across the repos touched this period.
 *
 * Returns an empty breakdown — never throws — when GitHub isn't configured or
 * no repo was touched. Per-repo failures are already isolated inside
 * `fetchRepoLanguages`; the try/catch here only covers what happens *before*
 * its loop (Octokit construction), matching how `createActivityRankingArticle`
 * guards the same call.
 */
export async function computeLanguageStats(
  repos: string[],
  token: string | undefined,
): Promise<LanguageStats> {
  if (!token || repos.length === 0) return { topLanguagesByBytes: [] };
  try {
    const perRepo = await fetchRepoLanguages(new Octokit({ auth: token }), repos);
    return { topLanguagesByBytes: aggregateLanguages(perRepo) };
  } catch (error) {
    console.error(`[github-stats] Language fetch aborted: ${describe(error)}`);
    return { topLanguagesByBytes: [] };
  }
}
