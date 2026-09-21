/**
 * GitHub-repository source processor — Step 2 of the
 * `github-repo-article-generators` plan.
 *
 * Given one repo the admin picked (`owner/name`), fetches its README, topics,
 * and (when the repo declares one) its homepage, and turns them into the seed
 * text the assisted-generation pipeline writes an article from. Same "pick an
 * item from a list, the server resolves the real content, degrade gracefully
 * when the primary content is missing" contract as
 * `@/lib/sources/calendar-event.ts`: there, absent Gemini notes fall back to
 * the event's title/description/attendees; here, an absent README falls back
 * to the repo's own description plus its topics, and a fetch-able homepage is
 * additive context on top of either.
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
 *   - `GET /repos/{owner}/{repo}` → `.homepage`, a nullable free-text URL the
 *     repo owner set themselves (no validation by GitHub) — hence the
 *     `new URL(...)` guard below before ever fetching it.
 */

import { Octokit } from "octokit";
import { htmlToText } from "html-to-text";

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

/**
 * Character budget for the homepage text fed into the prompt. Smaller than
 * {@link MAX_README_CHARS}: a project homepage is supplementary context (what
 * the maintainers say about it in their own words, on the record), not the
 * primary source, and it runs to far more nav/footer/cookie-banner noise per
 * useful paragraph than a README does.
 */
const MAX_WEBSITE_CHARS = 6_000;

/** A dead or unresponsive homepage must not stall generation. */
const WEBSITE_FETCH_TIMEOUT_MS = 8_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Clip `text` to `maxChars`, preferring the last markdown heading (`\n## `)
 * before the budget, then the last line break, over a raw character cut.
 *
 * Found via a real failure: `floci-io/floci`'s README carries a 210-row
 * "Supported Services" table (every emulated AWS service, comma-separated)
 * that starts just before the old plain-character cap and used to get cut
 * off mid-row — dumping a mangled, unterminated enumeration table as the
 * last thing the model saw. That shape (long, repetitive, truncated
 * mid-structure) is a plausible trigger for the "reasons forever, returns
 * empty text" failure this repo hit repeatedly while normal-prose READMEs
 * didn't. Preferring a heading boundary drops a trailing reference table
 * wholesale instead of truncating it into noise.
 */
function capText(text: string, maxChars: number, truncatedNote: string): string {
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  const lastHeading = clipped.lastIndexOf("\n## ");
  const lastBreak = clipped.lastIndexOf("\n");
  const cut = lastHeading > maxChars / 2 ? lastHeading : lastBreak > maxChars / 2 ? lastBreak : maxChars;
  const body = clipped.slice(0, cut);
  return `${body.trimEnd()}\n\n${truncatedNote}`;
}

/** Clip `readme` to {@link MAX_README_CHARS}, preferring the last line break before the budget. */
function capReadme(readme: string): string {
  return capText(readme, MAX_README_CHARS, "[README truncated]");
}

/**
 * Fetch a repo's declared homepage and reduce it to plain text, or `null` for
 * anything that isn't a fetchable, non-empty HTML page — an unset homepage, a
 * malformed URL (GitHub does not validate the field), a timeout, a non-2xx
 * response, or a non-HTML content type (a homepage pointing straight at a
 * PDF or a package-manager badge image, both seen in the wild).
 */
async function fetchHomepageText(homepage: string | null | undefined): Promise<string | null> {
  if (!homepage) return null;

  let url: URL;
  try {
    url = new URL(homepage);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WEBSITE_FETCH_TIMEOUT_MS),
      headers: { accept: "text/html" },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;

    const html = await response.text();
    const text = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "nav", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    }).trim();
    return text ? capText(text, MAX_WEBSITE_CHARS, "[website text truncated]") : null;
  } catch (error) {
    console.error(`[github-repo] Homepage fetch failed for ${homepage}: ${describe(error)}`);
    return null;
  }
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
 * `metadata.hasReadme`/`metadata.hasHomepage` record which sources actually
 * contributed, so the admin UI can tell an article grounded in real
 * documentation (and the maintainers' own site) apart from one written off a
 * one-line description. Never throws for a missing README or homepage — only
 * for a malformed `repo` argument or a repository that cannot be reached at
 * all (mirroring `fetchCalendarEventSource`, where the optional notes doc is
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

  // Fetched unconditionally now (previously only on the no-README fallback
  // path): `homepage` is needed either way, and `description` is still the
  // fallback body text when there's no README. Non-fatal like the two
  // fetches above — a failure here just means no homepage context and, on
  // the no-README path, a bare repo name instead of its description.
  let description = "";
  let homepage: string | null = null;
  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo: name });
    description = repoData.description ?? "";
    homepage = repoData.homepage ?? null;
  } catch (error) {
    console.error(`[github-repo] Repo metadata fetch failed for ${repo}: ${describe(error)}`);
  }
  const websiteText = await fetchHomepageText(homepage);
  const websiteSection = websiteText
    ? `Project website (${homepage}):\n${websiteText}`
    : "";

  try {
    const response = await octokit.rest.repos.getReadme({ owner, repo: name });
    const readme = Buffer.from(response.data.content, "base64").toString("utf-8");
    if (readme.trim()) {
      return {
        text: [capReadme(readme.trim()), topicsLine, websiteSection].filter(Boolean).join("\n\n"),
        sourceType: "github_repo",
        metadata: { repo, hasReadme: true, hasHomepage: websiteText !== null, topics },
      };
    }
  } catch (error) {
    // The 404 a README-less repo returns, or a transient failure — either way
    // fall through to the description/topics/website seed text below.
    console.error(`[github-repo] README fetch failed for ${repo}: ${describe(error)}`);
  }

  return {
    text: [repo, description, topicsLine, websiteSection].filter(Boolean).join("\n\n"),
    sourceType: "github_repo",
    metadata: { repo, hasReadme: false, hasHomepage: websiteText !== null, topics },
  };
}
