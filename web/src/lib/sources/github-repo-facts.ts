/**
 * GitHub-repository "facts" bundle — real, code-computed numbers about a repo
 * (languages, stars/forks/issues/watchers, age, license, release cadence,
 * weekly commit activity) for the deep repo-profile pipeline's data-driven
 * chart section. Sibling to `@/lib/sources/github-repo.ts` (which builds the
 * *text* seed from README/topics/homepage); this file builds the *facts*
 * seed those charts are grounded in. Same octokit construction (a fresh
 * client per call, `new Octokit({ auth: token })` — there is no shared client
 * factory in this codebase; `github-repo.ts`, `github.ts`, `rankings/activity.ts`
 * and `github-stats/language.ts` each build their own) and the same
 * "everything is best-effort, one bad sub-fetch degrades that field only"
 * resilience style used throughout `@/lib/generation/index.ts` and
 * `fetchGithubRepoSource` itself.
 *
 * Endpoint quirks worth flagging for a future reader:
 *   - `GET /repos/{owner}/{repo}/stats/participation` can return `202
 *     Accepted` with an empty/no body while GitHub computes the stat
 *     asynchronously (it caches per-repo and recomputes periodically). This
 *     is normal, expected behaviour — not an error — so it's treated as
 *     `weeklyCommits: null`, never thrown or retried.
 *   - `GET /repos/{owner}/{repo}/releases` has no "total count" endpoint;
 *     `count` here is `releases.length` off a single `per_page=10` page (i.e.
 *     "releases in the last page, capped at 10"), which is what the plan
 *     this file implements explicitly accepts as good enough.
 */

import { Octokit } from "octokit";

/** Milliseconds in a day, for the `ageInDays` / release-cadence math. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many releases to look at for `releases.count` / cadence — see file header note above. */
const RELEASES_PER_PAGE = 10;

/** Languages kept individually before the rest are rolled into a single "Other" bucket. */
const TOP_LANGUAGE_COUNT = 6;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface RepoFactsBundle {
  languages: Array<{ name: string; bytes: number; pct: number }>;
  /**
   * Whether the `GET /repos/{owner}/{repo}` sub-fetch actually succeeded (or a
   * caller handed its own already-fetched metadata in).
   *
   * This is deliberately *not* inferrable from the fields below: when that one
   * call fails, `stars`/`forks`/`openIssues`/`watchers` all default to `0`,
   * which is indistinguishable from a real brand-new repo that genuinely has
   * zero of each. The difference matters downstream — `buildFactsChartSpecs`
   * (`@/lib/article-chart`) charts those counts, and publishing "0 stars, 0
   * forks, 0 open issues" as a fetched fact is exactly the fabrication this
   * facts bundle exists to prevent. So "did the fetch succeed" is recorded
   * explicitly, and "the value happens to be 0" stays a separate question.
   */
  metadataOk: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  createdAt: string;
  pushedAt: string;
  ageInDays: number;
  license: string | null;
  releases: {
    count: number;
    latestTag: string | null;
    latestDate: string | null;
    cadenceDays: number | null;
  };
  /** Last 52 weekly commit counts across the whole repo (owner + everyone), or `null` if GitHub hasn't cached the stat yet (202) or the request failed. */
  weeklyCommits: number[] | null;
}

/**
 * The subset of `GET /repos/{owner}/{repo}` fields this file needs.
 * Structurally typed (not imported from `@octokit/plugin-rest-endpoint-methods`)
 * so a caller can hand over the repo object it already fetched — e.g.
 * `fetchGithubRepoSource`'s own `octokit.rest.repos.get()` call — without this
 * file re-requesting it.
 */
export interface RepoFactsMetadata {
  stargazers_count: number | null;
  forks_count: number | null;
  open_issues_count: number | null;
  subscribers_count: number | null;
  created_at: string | null;
  pushed_at: string | null;
  license: { spdx_id?: string | null; name?: string | null } | null;
}

export interface FetchRepoFactsOptions {
  /** Personal access token — the same one `fetchGithubRepoSource` uses. */
  token: string;
  /**
   * Repo metadata already fetched by the caller (e.g. the profile pipeline's
   * own call into `fetchGithubRepoSource`, which fetches `GET
   * /repos/{owner}/{repo}` internally) — pass it through to avoid this file
   * issuing a duplicate request for the same endpoint. When omitted, this
   * function fetches it itself.
   */
  repoMetadata?: RepoFactsMetadata;
}

const emptyReleases: RepoFactsBundle["releases"] = {
  count: 0,
  latestTag: null,
  latestDate: null,
  cadenceDays: null,
};

/**
 * Reduce a `{ language: bytes }` map (as returned by
 * `GET /repos/{owner}/{repo}/languages`) to the top {@link TOP_LANGUAGE_COUNT}
 * languages by bytes plus one "Other" bucket for the remainder — only when
 * there *is* a remainder, per the plan's "only if there were more than 6 to
 * begin with" rule.
 */
function computeLanguages(bytesByLanguage: Record<string, number>): RepoFactsBundle["languages"] {
  const entries = Object.entries(bytesByLanguage).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (total <= 0) return [];

  const pct = (bytes: number) => Math.round((bytes / total) * 1000) / 10;

  const top = entries.slice(0, TOP_LANGUAGE_COUNT);
  const rest = entries.slice(TOP_LANGUAGE_COUNT);

  const languages = top.map(([name, bytes]) => ({ name, bytes, pct: pct(bytes) }));
  if (rest.length > 0) {
    const otherBytes = rest.reduce((sum, [, bytes]) => sum + bytes, 0);
    languages.push({ name: "Other", bytes: otherBytes, pct: pct(otherBytes) });
  }
  return languages;
}

/**
 * Reduce a page of `GET /repos/{owner}/{repo}/releases` entries to the
 * `releases` slice of {@link RepoFactsBundle}. Zero releases is a normal,
 * successful case (a repo with no tagged releases) — not an error.
 */
function computeReleases(
  releaseList: Array<{ tag_name: string; published_at: string | null; created_at: string | null }>,
): RepoFactsBundle["releases"] {
  if (releaseList.length === 0) return emptyReleases;

  const latest = releaseList[0];
  const latestDate = latest.published_at ?? latest.created_at ?? null;

  // Newest-first, matching GitHub's own ordering — but re-sort defensively
  // rather than trust it, since cadence math depends on strict ordering.
  const dated = releaseList
    .map((release) => release.published_at ?? release.created_at)
    .filter((date): date is string => Boolean(date))
    .map((date) => new Date(date).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a);

  let cadenceDays: number | null = null;
  if (dated.length >= 2) {
    const gaps: number[] = [];
    for (let i = 0; i < dated.length - 1; i++) {
      gaps.push((dated[i] - dated[i + 1]) / MS_PER_DAY);
    }
    cadenceDays = Math.round((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 10) / 10;
  }

  return {
    count: releaseList.length,
    latestTag: latest.tag_name ?? null,
    latestDate,
    cadenceDays,
  };
}

/**
 * Fetch the real-number facts bundle a repo's "By the Numbers" chart section
 * is grounded in. Every field degrades independently — languages, repo
 * metadata, releases and weekly-commit stats are each wrapped in their own
 * try/catch, so a 404/rate-limit/timeout on any one endpoint leaves the rest
 * of the bundle intact rather than failing the whole call. Mirrors the
 * warn-and-continue style already used throughout
 * `@/lib/generation/index.ts` and `fetchGithubRepoSource`.
 */
export async function fetchRepoFacts(
  owner: string,
  repo: string,
  { token, repoMetadata }: FetchRepoFactsOptions,
): Promise<RepoFactsBundle> {
  const octokit = new Octokit({ auth: token });

  let languages: RepoFactsBundle["languages"] = [];
  try {
    const { data } = await octokit.rest.repos.listLanguages({ owner, repo });
    languages = computeLanguages(data);
  } catch (error) {
    console.error(`[github-repo-facts] Languages fetch failed for ${owner}/${repo}: ${describe(error)}`);
  }

  let metadata = repoMetadata ?? null;
  // Tracks the *fetch*, not the values — see `metadataOk`'s doc comment on
  // `RepoFactsBundle`. Metadata the caller supplied counts as fetched: they
  // only have it because their own `repos.get` succeeded.
  let metadataOk = metadata !== null;
  if (!metadata) {
    try {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      metadata = data;
      metadataOk = true;
    } catch (error) {
      console.error(`[github-repo-facts] Repo metadata fetch failed for ${owner}/${repo}: ${describe(error)}`);
    }
  }

  const createdAt = metadata?.created_at ?? "";
  const pushedAt = metadata?.pushed_at ?? "";
  const createdTime = createdAt ? new Date(createdAt).getTime() : NaN;
  const ageInDays = Number.isNaN(createdTime) ? 0 : Math.floor((Date.now() - createdTime) / MS_PER_DAY);

  let releases = emptyReleases;
  try {
    const { data } = await octokit.rest.repos.listReleases({ owner, repo, per_page: RELEASES_PER_PAGE });
    releases = computeReleases(data);
  } catch (error) {
    console.error(`[github-repo-facts] Releases fetch failed for ${owner}/${repo}: ${describe(error)}`);
  }

  let weeklyCommits: number[] | null = null;
  try {
    const response = await octokit.rest.repos.getParticipationStats({ owner, repo });
    const all = (response.data as { all?: number[] } | null)?.all;
    // A 202 (stat not cached yet) resolves successfully with no/empty `all`
    // array — normal, expected, and handled the same as any other miss.
    if (response.status === 200 && Array.isArray(all) && all.length > 0) {
      weeklyCommits = all.slice(-52);
    }
  } catch (error) {
    console.error(`[github-repo-facts] Participation stats fetch failed for ${owner}/${repo}: ${describe(error)}`);
  }

  return {
    languages,
    metadataOk,
    stars: metadata?.stargazers_count ?? 0,
    forks: metadata?.forks_count ?? 0,
    openIssues: metadata?.open_issues_count ?? 0,
    watchers: metadata?.subscribers_count ?? 0,
    createdAt,
    pushedAt,
    ageInDays,
    license: metadata?.license?.spdx_id ?? metadata?.license?.name ?? null,
    releases,
    weeklyCommits,
  };
}
