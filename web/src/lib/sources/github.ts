/**
 * GitHub activity source: everything a user did in a half-open
 * `[periodStart, periodEnd)` range, as `ActivityItem`s —
 *   commit, pr, review, issue, release, repo_created, star, gist
 * — plus `fetchRepoDetails` for what each repo touched *is*.
 *
 * Every event type is fetched in its own try/catch, so one failing endpoint
 * never aborts the whole fetch; it's reported through `onWarning` instead.
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

/** Repositories whose releases are looked up at once. */
const RELEASE_LOOKUPS = 6;

/** Statuses that mean "no (more) results" rather than a failure. */
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
 * Yield every item across all pages, treating a 404/422 as "no more
 * results".
 *
 * Yielding item-by-item (rather than collecting) lets the callers that rely on
 * GitHub's newest-first ordering `break` out early.
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
  /** GitHub login whose activity is chronicled. */
  username: string;
  /** The server's personal access token (`GITHUB_TOKEN`). */
  token: string;
  /**
   * Called once per event-type section that failed, with a human-readable
   * reason (e.g. `"Starred repos fetch failed: Bad credentials"`) — so a
   * section that failed isn't mistaken for one that was genuinely empty.
   * Failures are logged either way.
   */
  onWarning?: (message: string) => void;
}

/**
 * Fetch all relevant GitHub activity for `username` inside `[periodStart,
 * periodEnd)`.
 *
 * Never throws for individual endpoint failures — they are logged, reported
 * through `onWarning` when given, and skipped.
 */
export async function fetchGithubActivity({
  username,
  token,
  periodStart,
  periodEnd,
  onWarning,
}: GithubFetchOptions): Promise<ActivityItem[]> {
  const period: Period = { periodStart, periodEnd };
  /** One section failed: log it (as always) and tell the caller, if it asked. */
  const sectionFailed = (what: string, error: unknown): void => {
    const message = `${what} fetch failed: ${describe(error)}`;
    console.error(`[github] ${message}`);
    onWarning?.(message);
  };
  const startDate = isoDate(periodStart);
  // periodEnd is exclusive; GitHub's `a..b` search range is inclusive.
  const endDate = isoDate(new Date(periodEnd.getTime() - 86_400_000));

  const octokit = new Octokit({ auth: token });
  /**
   * One event type's fetch, run alongside the others: whatever it pushed
   * before failing is kept, and the failure reported, never thrown.
   */
  const collect = async (what: string, run: (activities: ActivityItem[]) => Promise<void>): Promise<ActivityItem[]> => {
    const activities: ActivityItem[] = [];
    try {
      await run(activities);
    } catch (error) {
      sectionFailed(what, error);
    }
    return activities;
  };
  // Every event type in parallel — they're independent requests, and one
  // after another they took ~20s for a busy month.
  const jobs: Promise<ActivityItem[]>[] = [];

  // ---------------------------------------------------------------------
  // Commits (search API)
  // ---------------------------------------------------------------------
  jobs.push(
    collect("Commits", async (activities) => {
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
    }),
  );

  // ---------------------------------------------------------------------
  // Pull Requests opened (search API)
  // ---------------------------------------------------------------------
  jobs.push(
    collect("PRs", async (activities) => {
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
    }),
  );

  // ---------------------------------------------------------------------
  // PR reviews submitted (search API)
  // ---------------------------------------------------------------------
  jobs.push(
    collect("PR reviews", async (activities) => {
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
    }),
  );

  // ---------------------------------------------------------------------
  // Issues created (search API)
  // ---------------------------------------------------------------------
  jobs.push(
    collect("Issues", async (activities) => {
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
    }),
  );

  // ---------------------------------------------------------------------
  // Releases published across the user's repos
  // ---------------------------------------------------------------------
  jobs.push(
    collect("Releases", async (activities) => {
      const repoPages = octokit.paginate.iterator("GET /users/{username}/repos", {
        username,
        per_page: 100,
        sort: "pushed",
      });
      const repos: string[] = [];
      for await (const repoObj of paginateItems(repoPages)) {
        if (repoObj.full_name?.includes("/")) repos.push(repoObj.full_name);
      }
      // One request per repository — RELEASE_LOOKUPS at a time, not one by one.
      for (let i = 0; i < repos.length; i += RELEASE_LOOKUPS) {
        await Promise.all(
          repos.slice(i, i + RELEASE_LOOKUPS).map(async (repoName) => {
            const [owner, repo] = repoName.split("/");
            const releasePages = octokit.paginate.iterator(
              "GET /repos/{owner}/{repo}/releases",
              { owner, repo, per_page: 20 },
            );
            for await (const rel of paginateItems(releasePages)) {
              const publishedAt = parseTimestamp(rel.published_at);
              // Newest first: once past the period there's nothing left in it.
              if (beforePeriod(publishedAt, period)) break;
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
          }),
        );
      }
    }),
  );

  // ---------------------------------------------------------------------
  // Repositories created during the period (username's public repos)
  // ---------------------------------------------------------------------
  jobs.push(
    collect("Repos-created", async (activities) => {
      const pages = octokit.paginate.iterator("GET /users/{username}/repos", {
        username,
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
    }),
  );

  // ---------------------------------------------------------------------
  // Starred repositories (`starred_at` inside the period)
  // ---------------------------------------------------------------------
  jobs.push(
    collect("Starred repos", async (activities) => {
      // `octokit.paginate` cannot carry a per-request Accept header, and the
      // `starred_at` field only exists under the star media type — so this one
      // endpoint is paged by hand.
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
    }),
  );

  // ---------------------------------------------------------------------
  // Gists created during the period
  // ---------------------------------------------------------------------
  jobs.push(
    collect("Gists", async (activities) => {
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
    }),
  );

  // Concatenated in the fixed order above, whatever order they finish in.
  return (await Promise.all(jobs)).flat();
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
 * carries `starred_at`. Stops on a short page, or on a 404/422.
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
        // Opt into the `starred_at` timestamps.
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

/** What the front page can say about a repository beyond its name. */
export interface RepoDetails {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  forks: number | null;
  topics: string[];
  isFork: boolean;
  archived: boolean;
  url: string | null;
}

/**
 * `RepoDetails` from a full repository object — the shape `GET /repos/…`,
 * `GET /users/{u}/repos` and the starred listing all return. `null` when
 * `raw` isn't one (a commit or PR payload, say).
 */
function repoDetailsFromRaw(raw: unknown): RepoDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.full_name !== "string" || typeof r.stargazers_count !== "number") return null;
  return {
    fullName: r.full_name,
    description: typeof r.description === "string" && r.description.trim() ? r.description.trim() : null,
    language: typeof r.language === "string" ? r.language : null,
    stars: r.stargazers_count,
    forks: typeof r.forks_count === "number" ? r.forks_count : null,
    topics: Array.isArray(r.topics) ? r.topics.filter((t): t is string => typeof t === "string") : [],
    isFork: r.fork === true,
    archived: r.archived === true,
    url: typeof r.html_url === "string" ? r.html_url : null,
  };
}

/** Repos looked up by `fetchRepoDetails` at most — one API call each, on the server's token. */
const MAX_DETAIL_LOOKUPS = 10;

/**
 * Details for every repo the period touched: straight from the activity's
 * own payloads where they already carry a full repository object (stars,
 * repos created), plus one `GET /repos/{owner}/{repo}` for each of the
 * `MAX_DETAIL_LOOKUPS` busiest repos that don't — commits, PRs and issues
 * only name their repo. A failed lookup just leaves that repo without
 * details; it never fails the edition.
 */
export async function fetchRepoDetails(
  activity: ActivityItem[],
  token: string,
): Promise<Map<string, RepoDetails>> {
  const details = new Map<string, RepoDetails>();
  for (const item of activity) {
    const found = repoDetailsFromRaw(item.raw);
    if (found) details.set(found.fullName.toLowerCase(), found);
  }

  const counts = new Map<string, number>();
  for (const item of activity) {
    if (!item.repo || !item.repo.includes("/") || item.eventType === "star") continue;
    counts.set(item.repo, (counts.get(item.repo) ?? 0) + 1);
  }
  const missing = [...counts.entries()]
    .filter(([repo]) => !details.has(repo.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DETAIL_LOOKUPS)
    .map(([repo]) => repo);

  const octokit = new Octokit({ auth: token });
  await Promise.all(
    missing.map(async (repo) => {
      const [owner, name] = repo.split("/");
      try {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}", { owner, repo: name });
        const found = repoDetailsFromRaw(data);
        if (found) details.set(repo.toLowerCase(), found);
      } catch (error) {
        console.warn(`[github] details for ${repo} unavailable: ${describe(error)}`);
      }
    }),
  );
  return details;
}
