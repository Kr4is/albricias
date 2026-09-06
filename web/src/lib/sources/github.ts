/**
 * GitHub activity source.
 *
 * Ported from `app/services/github.py` (`fetch_monthly_activity`), generalised
 * from a fixed `(year, month)` to an arbitrary half-open `[periodStart,
 * periodEnd)` range so weekly and monthly editions share one code path.
 *
 * Fetches the same eight event types as the Python original, in the same order:
 *   commit, pr, review, issue, release, repo_created, star, gist
 *
 * Every block keeps the original per-endpoint try/catch so one failing endpoint
 * never aborts the whole fetch (mirrored in `admin.py`'s non-fatal warnings).
 */

import { Octokit, RequestError } from "octokit";

import {
  type ActivityItem,
  type Period,
  beforePeriod,
  inPeriod,
  parseTimestamp,
} from "./types";

const GITHUB_API = "https://api.github.com";

/** Statuses `_paginate` in the Python original swallowed silently. */
const IGNORED_STATUSES = [404, 422];

function isIgnorableError(error: unknown): boolean {
  return (
    error instanceof RequestError && IGNORED_STATUSES.includes(error.status)
  );
}

/** `YYYY-MM-DD` in UTC — the form GitHub's search qualifiers expect. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `https://api.github.com/repos/owner/name` → `owner/name`. */
function repoFromUrl(repositoryUrl: string): string {
  const prefix = `${GITHUB_API}/repos/`;
  return repositoryUrl.startsWith(prefix)
    ? repositoryUrl.slice(prefix.length)
    : repositoryUrl;
}

/**
 * Yield every item across all pages, tolerating the 404/422 responses the
 * Python `_paginate` helper treated as "no more results".
 *
 * Yielding item-by-item (rather than collecting) lets the callers that rely on
 * GitHub's newest-first ordering `break` out early, exactly like the original.
 */
async function* paginateItems<T>(
  iterator: AsyncIterable<{ data: T[] }>,
): AsyncGenerator<T> {
  try {
    for await (const page of iterator) {
      for (const item of page.data) {
        yield item;
      }
    }
  } catch (error) {
    if (!isIgnorableError(error)) throw error;
  }
}

export interface GithubFetchOptions extends Period {
  /** GitHub login whose activity is chronicled (`GITHUB_USERNAME`). */
  username: string;
  /** Personal access token (`GITHUB_TOKEN`). */
  token: string;
}

/**
 * Fetch all relevant GitHub activity for `username` inside `[periodStart,
 * periodEnd)`.
 *
 * Never throws for individual endpoint failures — they are logged and skipped,
 * matching the Python original.
 */
export async function fetchGithubActivity({
  username,
  token,
  periodStart,
  periodEnd,
}: GithubFetchOptions): Promise<ActivityItem[]> {
  const period: Period = { periodStart, periodEnd };
  const startDate = isoDate(periodStart);
  // periodEnd is exclusive; GitHub's `a..b` search range is inclusive.
  const endDate = isoDate(new Date(periodEnd.getTime() - 86_400_000));

  const octokit = new Octokit({ auth: token });
  const activities: ActivityItem[] = [];

  // ---------------------------------------------------------------------
  // Commits (search API)
  // ---------------------------------------------------------------------
  try {
    const q = `author:${username} author-date:${startDate}..${endDate}`;
    const pages = octokit.paginate.iterator("GET /search/commits", {
      q,
      per_page: 100,
    });
    for await (const c of paginateItems(pages)) {
      activities.push({
        source: "github",
        eventType: "commit",
        repo: c.repository?.full_name ?? "unknown",
        title: (c.commit?.message ?? "").split("\n")[0].slice(0, 200),
        url: c.html_url ?? null,
        timestamp: parseTimestamp(c.commit?.author?.date),
        raw: c,
      });
    }
  } catch (error) {
    console.error(`[github] Commits fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Pull Requests opened (search API)
  // ---------------------------------------------------------------------
  try {
    const q = `author:${username} type:pr created:${startDate}..${endDate}`;
    const pages = octokit.paginate.iterator("GET /search/issues", {
      q,
      per_page: 100,
    });
    for await (const pr of paginateItems(pages)) {
      activities.push({
        source: "github",
        eventType: "pr",
        repo: repoFromUrl(pr.repository_url ?? ""),
        title: (pr.title ?? "").slice(0, 200),
        url: pr.html_url ?? null,
        timestamp: parseTimestamp(pr.created_at),
        raw: pr,
      });
    }
  } catch (error) {
    console.error(`[github] PRs fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // PR reviews submitted (search API)
  // ---------------------------------------------------------------------
  try {
    const q = `reviewed-by:${username} type:pr updated:${startDate}..${endDate}`;
    const pages = octokit.paginate.iterator("GET /search/issues", {
      q,
      per_page: 100,
    });
    for await (const pr of paginateItems(pages)) {
      activities.push({
        source: "github",
        eventType: "review",
        repo: repoFromUrl(pr.repository_url ?? ""),
        title: (pr.title ?? "").slice(0, 200),
        url: pr.html_url ?? null,
        timestamp: parseTimestamp(pr.updated_at),
        raw: pr,
      });
    }
  } catch (error) {
    console.error(`[github] PR reviews fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Issues created (search API)
  // ---------------------------------------------------------------------
  try {
    const q = `author:${username} type:issue created:${startDate}..${endDate}`;
    const pages = octokit.paginate.iterator("GET /search/issues", {
      q,
      per_page: 100,
    });
    for await (const iss of paginateItems(pages)) {
      activities.push({
        source: "github",
        eventType: "issue",
        repo: repoFromUrl(iss.repository_url ?? ""),
        title: (iss.title ?? "").slice(0, 200),
        url: iss.html_url ?? null,
        timestamp: parseTimestamp(iss.created_at),
        raw: iss,
      });
    }
  } catch (error) {
    console.error(`[github] Issues fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Releases published across the user's repos
  // ---------------------------------------------------------------------
  try {
    const repoPages = octokit.paginate.iterator("GET /users/{username}/repos", {
      username,
      per_page: 100,
      sort: "pushed",
    });
    for await (const repoObj of paginateItems(repoPages)) {
      const repoName = repoObj.full_name ?? "";
      const [owner, repo] = repoName.split("/");
      if (!owner || !repo) continue;

      const releasePages = octokit.paginate.iterator(
        "GET /repos/{owner}/{repo}/releases",
        { owner, repo, per_page: 20 },
      );
      for await (const rel of paginateItems(releasePages)) {
        const publishedAt = parseTimestamp(rel.published_at);
        if (!inPeriod(publishedAt, period)) continue;
        activities.push({
          source: "github",
          eventType: "release",
          repo: repoName,
          title: (rel.name || rel.tag_name || "").slice(0, 200),
          url: rel.html_url ?? null,
          timestamp: publishedAt,
          raw: rel,
        });
      }
    }
  } catch (error) {
    console.error(`[github] Releases fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Repositories created during the period (authenticated user's repos)
  // ---------------------------------------------------------------------
  try {
    const pages = octokit.paginate.iterator("GET /user/repos", {
      per_page: 100,
      sort: "created",
      direction: "desc",
    });
    for await (const repoObj of paginateItems(pages)) {
      const createdAt = parseTimestamp(repoObj.created_at);
      if (!inPeriod(createdAt, period)) {
        // Sorted newest-first: once we pass the period there is nothing left.
        if (beforePeriod(createdAt, period)) break;
        continue;
      }
      const repoName = repoObj.full_name ?? "";
      const description = (repoObj.description || "New repository").slice(0, 200);
      activities.push({
        source: "github",
        eventType: "repo_created",
        repo: repoName,
        title: `${repoName}: ${description}`,
        url: repoObj.html_url ?? null,
        timestamp: createdAt,
        raw: repoObj,
      });
    }
  } catch (error) {
    console.error(`[github] Repos-created fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Starred repositories (`starred_at` inside the period)
  // ---------------------------------------------------------------------
  try {
    // `octokit.paginate` cannot carry a per-request Accept header, and the
    // `starred_at` field only exists under the star media type — so this one
    // endpoint is paged by hand (Python's `_paginate_with_headers`).
    for await (const item of iterateStarred(octokit, username)) {
      const starredAt = parseTimestamp(item.starred_at);
      if (!starredAt) continue;
      // Stars come back newest-first; stop once we go past the period.
      if (beforePeriod(starredAt, period)) break;
      if (!inPeriod(starredAt, period)) continue;

      const repoObj = item.repo ?? {};
      const repoName = repoObj.full_name ?? "";
      const description = (repoObj.description || "").slice(0, 150);
      const title = description ? `${repoName} — ${description}` : repoName;
      activities.push({
        source: "github",
        eventType: "star",
        repo: repoName,
        title: title.slice(0, 200),
        url: repoObj.html_url ?? null,
        timestamp: starredAt,
        raw: repoObj,
      });
    }
  } catch (error) {
    console.error(`[github] Starred repos fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Gists created during the period
  // ---------------------------------------------------------------------
  try {
    const pages = octokit.paginate.iterator("GET /users/{username}/gists", {
      username,
      per_page: 100,
    });
    for await (const gist of paginateItems(pages)) {
      const createdAt = parseTimestamp(gist.created_at);
      if (!createdAt) continue;
      if (beforePeriod(createdAt, period)) break;
      if (!inPeriod(createdAt, period)) continue;
      activities.push({
        source: "github",
        eventType: "gist",
        repo: null,
        title: (gist.description || "Untitled gist").slice(0, 200),
        url: gist.html_url ?? null,
        timestamp: createdAt,
        raw: gist,
      });
    }
  } catch (error) {
    console.error(`[github] Gists fetch failed: ${describe(error)}`);
  }

  return activities;
}

/**
 * The `starred_at` view of `GET /users/{username}/starred`, which Octokit types
 * as a union that only narrows on the runtime Accept header.
 */
interface StarredItem {
  starred_at?: string;
  repo?: {
    full_name?: string;
    description?: string | null;
    html_url?: string;
  };
}

const STARRED_PER_PAGE = 100;

/**
 * Page `GET /users/{username}/starred` with the star media type so each item
 * carries `starred_at`. Stops on a short page, or on the 404/422 responses the
 * Python helper treated as "no more results".
 */
async function* iterateStarred(
  octokit: Octokit,
  username: string,
): AsyncGenerator<StarredItem> {
  for (let page = 1; ; page += 1) {
    let items: StarredItem[];
    try {
      const response = await octokit.request("GET /users/{username}/starred", {
        username,
        per_page: STARRED_PER_PAGE,
        page,
        // Opt into the `starred_at` timestamps (Python's `_star_headers`).
        headers: { accept: "application/vnd.github.v3.star+json" },
      });
      items = response.data as unknown as StarredItem[];
    } catch (error) {
      if (isIgnorableError(error)) return;
      throw error;
    }

    for (const item of items) {
      yield item;
    }
    if (items.length < STARRED_PER_PAGE) return;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
