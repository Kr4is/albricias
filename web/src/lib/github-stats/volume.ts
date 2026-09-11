/**
 * Volume metrics — *how much* happened this period, and where.
 *
 * Pure counting over the already-stored rows; no I/O, never throws. A row with
 * a `null` repo (gists carry none — see the gists block in
 * `@/lib/sources/github`) contributes to its event-type total but not to any
 * per-repo figure.
 */

import { topEntry } from "./shared";
import type { GithubStatsRow, VolumeStats } from "./types";

/**
 * The `owner/name` this row touched, if any. `"unknown"` is the commit-search
 * fallback `@/lib/sources/github` writes when a hit carries no repository — a
 * placeholder, not a repo, so it is excluded here exactly as
 * `fetchRepoLanguages` excludes it downstream for having no owner segment.
 */
function touchedRepo(row: GithubStatsRow): string | null {
  return row.repo && row.repo !== "unknown" ? row.repo : null;
}

/**
 * Event totals, distinct/most-active repos, and the period's new and starred
 * repositories.
 *
 * `mostActiveRepo` counts *every* event type, not just commits: a period spent
 * entirely on reviews and issues in one repo is still a period spent in that
 * repo, and the commit-only view is already available via `totalCommits`.
 */
export function computeVolumeStats(rows: GithubStatsRow[]): VolumeStats {
  const eventCounts = new Map<string, number>();
  const repoCounts = new Map<string, number>();
  const newRepos = new Set<string>();
  const starredRepos = new Set<string>();

  for (const row of rows) {
    eventCounts.set(row.eventType, (eventCounts.get(row.eventType) ?? 0) + 1);

    const repo = touchedRepo(row);
    if (!repo) continue;
    repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1);
    if (row.eventType === "repo_created") newRepos.add(repo);
    if (row.eventType === "star") starredRepos.add(repo);
  }

  const mostActive = topEntry(repoCounts);

  return {
    totalCommits: eventCounts.get("commit") ?? 0,
    totalPrs: eventCounts.get("pr") ?? 0,
    totalIssues: eventCounts.get("issue") ?? 0,
    totalReleases: eventCounts.get("release") ?? 0,
    distinctRepos: repoCounts.size,
    mostActiveRepo: mostActive ? { repo: mostActive[0], count: mostActive[1] } : null,
    newRepos: [...newRepos].sort(),
    starredRepos: [...starredRepos].sort(),
  };
}

/** Distinct `owner/name` repos touched this period, sorted — the input `fetchRepoLanguages` expects. */
export function touchedRepos(rows: GithubStatsRow[]): string[] {
  const repos = new Set<string>();
  for (const row of rows) {
    const repo = touchedRepo(row);
    if (repo) repos.add(repo);
  }
  return [...repos].sort();
}
