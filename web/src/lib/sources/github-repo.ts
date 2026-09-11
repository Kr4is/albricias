/**
 * GitHub-repository source processor — Step 2 of the
 * `github-repo-article-generators` plan.
 *
 * Given one repo the admin picked (`owner/name`), fetches its README and its
 * topics and turns them into the seed text the assisted-generation pipeline
 * writes an article from. Same "pick an item from a list, the server resolves
 * the real content, degrade gracefully when the primary content is missing"
 * contract as `@/lib/sources/calendar-event.ts`: there, absent Gemini notes
 * fall back to the event's title/description/attendees; here, an absent README
 * falls back to the repo's own description plus its topics.
 *
 * Endpoint shapes verified against the live API during implementation rather
 * than assumed:
 *   - `GET /repos/{owner}/{repo}/readme` → `{ content, encoding: "base64", size }`,
 *     and a plain `404` for a repo with no README at all (confirmed against
 *     `octocat/octocat.github.io`) — a real, common case for a starred-but-
 *     undocumented repo, hence the fallback below.
 *   - `GET /repos/{owner}/{repo}/topics` → `{ names: string[] }`, returned
 *     `200` with no `mercy-preview` Accept header needed (the historical quirk
 *     is gone; Octokit's typed request sends whatever the endpoint wants).
 */

import { Octokit } from "octokit";

import type { SourceResult } from "./types";

/**
 * Character budget for the README text fed into the prompt.
 *
 * Sized against real READMEs measured during implementation rather than
 * guessed: a well-documented project's README lands in the 3–8k range
 * (`vercel/next.js` 3.2k, `facebook/react` 5.3k, `prisma/prisma` 5.9k,
 * `mastra-ai/mastra` 7.3k), while reference-manual and awesome-list repos run
 * an order of magnitude longer (`tj/commander.js` 43k, `sindresorhus/awesome`
 * 78k, `axios/axios` 108k). 12k passes the entire README through untouched for
 * the typical case this feature is aimed at, and clips only the outliers —
 * where the tail is changelog/API-reference filler anyway, not the getting-
 * started material the generators actually need.
 *
 * This bounds the *input*, which is a different concern from the output cap
 * `@/mastra/agents/base.ts` deliberately stopped imposing (an under-budgeted
 * `maxOutputTokens` truncated reasoning-model responses). Cross-referenced
 * here so a future reader doesn't read "cap" and assume the two are the same
 * mistake: an unbounded prompt costs money and crowds the context window, an
 * unbounded completion does not.
 */
const MAX_README_CHARS = 12_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Clip `readme` to {@link MAX_README_CHARS}, preferring the last line break
 * before the budget so the prompt never ends mid-sentence.
 */
function capReadme(readme: string): string {
  if (readme.length <= MAX_README_CHARS) return readme;
  const clipped = readme.slice(0, MAX_README_CHARS);
  const lastBreak = clipped.lastIndexOf("\n");
  const body = lastBreak > MAX_README_CHARS / 2 ? clipped.slice(0, lastBreak) : clipped;
  return `${body.trimEnd()}\n\n[README truncated]`;
}

export interface FetchGithubRepoSourceOptions {
  /** Personal access token — the same one the GitHub activity fetch uses. */
  token: string;
  /** `owner/name`, exactly as `ServiceActivity.repo` stores it. */
  repo: string;
}

/**
 * Fetch one repository and turn it into a `SourceResult`, ready for the
 * existing assisted-generation pipeline (`source_type: "github_repo"`).
 *
 * `metadata.hasReadme` records which path was taken, so the admin UI can tell
 * an article grounded in real documentation apart from one written off a
 * one-line description. Never throws for a missing README — only for a
 * malformed `repo` argument or a repository that cannot be reached at all
 * (mirroring `fetchCalendarEventSource`, where the optional notes doc is
 * swallowed but the event itself is required).
 */
export async function fetchGithubRepoSource({
  token,
  repo,
}: FetchGithubRepoSourceOptions): Promise<SourceResult> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo "${repo}" — expected "owner/name".`);
  }

  const octokit = new Octokit({ auth: token });

  let topics: string[] = [];
  try {
    const response = await octokit.rest.repos.getAllTopics({ owner, repo: name });
    topics = response.data.names;
  } catch (error) {
    // Non-fatal: topics only ever decorate the seed text, and plenty of repos
    // simply have none (`tj/commander.js` returns `{ names: [] }`).
    console.error(`[github-repo] Topics fetch failed for ${repo}: ${describe(error)}`);
  }
  const topicsLine = topics.length > 0 ? `Topics: ${topics.join(", ")}` : "";

  try {
    const response = await octokit.rest.repos.getReadme({ owner, repo: name });
    const readme = Buffer.from(response.data.content, "base64").toString("utf-8");
    if (readme.trim()) {
      return {
        text: [capReadme(readme.trim()), topicsLine].filter(Boolean).join("\n\n"),
        sourceType: "github_repo",
        metadata: { repo, hasReadme: true, topics },
      };
    }
  } catch (error) {
    // The 404 a README-less repo returns, or a transient failure — either way
    // fall through to the description/topics seed text below.
    console.error(`[github-repo] README fetch failed for ${repo}: ${describe(error)}`);
  }

  // One extra call, only on this path: the README response carries no
  // description, and the topics response carries only `names`.
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo: name });

  return {
    text: [repo, repoData.description ?? "", topicsLine].filter(Boolean).join("\n\n"),
    sourceType: "github_repo",
    metadata: { repo, hasReadme: false, topics },
  };
}
