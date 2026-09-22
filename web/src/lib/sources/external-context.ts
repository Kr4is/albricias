/**
 * External documentation/comparison context for the deep repo-profile
 * pipeline — a repo's own README/homepage (already fetched by
 * `@/lib/sources/github-repo.ts`) says what the maintainers claim; this file
 * supplements that with docs sites and "vs alternatives" framing a README
 * rarely contains.
 *
 * Two-step, both best-effort/non-throwing:
 *   A) URL-pattern heuristics — guess likely docs URLs (readthedocs, gitbook,
 *      a `/docs` path off the homepage, the GitHub wiki) and fetch them
 *      directly. No new dependency: same `html-to-text` conversion and same
 *      fetch-timeout budget `github-repo.ts` already uses for its homepage
 *      fetch.
 *   B) Tavily web search — only fired when useful (comparison text can never
 *      come from URL-guessing; docs text only if step A found none), and
 *      only when a Tavily API key is configured at `/admin/settings`
 *      (`integrations.tavily.apiKey`, same DB-stored/encrypted contract as
 *      every other credential — see `resolveTavilyApiKey()` below). Plain
 *      `fetch()` to Tavily's HTTP API, matching this codebase's preference
 *      for direct `fetch()` over adding a client SDK (again, per
 *      `github-repo.ts`).
 */

import { htmlToText } from "html-to-text";
import { getSetting } from "@/lib/config/settings";

/** Matches `WEBSITE_FETCH_TIMEOUT_MS` in `@/lib/sources/github-repo.ts` — a dead/slow page must not stall generation. */
const FETCH_TIMEOUT_MS = 8_000;

/** A fetched page must extract to more than this many characters of text to count as "real content" rather than a redirect/landing stub. */
const MIN_CONTENT_CHARS = 500;

/** At most this many heuristic URLs are kept once they clear {@link MIN_CONTENT_CHARS}. */
const MAX_HEURISTIC_HITS = 2;

/** Combined character cap for step A's `docsText`. */
const MAX_DOCS_CHARS = 8_000;

/** Combined character cap for step B's extra text (split across `docsText`/`comparisonText`). */
const MAX_TAVILY_CHARS = 6_000;

/** Results kept per Tavily query. */
const TAVILY_MAX_RESULTS = 3;

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

let warnedTavilyDisabled = false;
let warnedTavilyRejected = false;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the Tavily API key from `/admin/settings` (`integrations.tavily.apiKey`,
 * encrypted at rest) — same "DB-stored, no `.env` fallback" contract
 * `resolveAiModel()` (`@/lib/ai/provider.ts`) uses for the AI provider keys.
 * Returns `null` when unset, so {@link fetchExternalContext} degrades to
 * URL-pattern heuristics only, the same way it already does for every other
 * optional source.
 */
async function resolveTavilyApiKey(): Promise<string | null> {
  const apiKey = await getSetting("integrations.tavily.apiKey", { encrypted: true });
  return apiKey ?? null;
}

export interface ExternalContextBundle {
  docsText: string | null;
  comparisonText: string | null;
  sourceUrls: string[];
}

export interface FetchExternalContextParams {
  owner: string;
  repo: string;
  homepage: string | null;
}

/**
 * Strip `https://`/`http://`/`www.` and everything from the first `/`
 * onward, leaving a bare-ish domain to build a `docs.<domain>` guess from.
 * Deliberately not a full public-suffix-list parse — just enough to turn
 * `https://www.example.com/some/path` into `example.com`.
 */
function bareDomain(url: string): string | null {
  const withoutProtocol = url.replace(/^https?:\/\//i, "");
  const withoutWww = withoutProtocol.replace(/^www\./i, "");
  const domain = withoutWww.split("/")[0]?.trim();
  return domain ? domain : null;
}

/**
 * A key that collapses candidate URLs pointing at the same page: lowercased
 * host, no trailing slash on the path, no query or fragment.
 *
 * The trailing slash is the point. Two of the homepage guesses below —
 * `${homepage}/docs` and `${homepage}docs/` — differ only by it, so without
 * this they'd both be fetched, both return the same page, and between them
 * consume the entire {@link MAX_HEURISTIC_HITS} budget with one duplicated
 * document instead of two distinct sources. Returns `null` for anything
 * unparseable, which {@link buildHeuristicUrls} drops.
 */
function dedupeKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/** Build the candidate documentation URLs for step A, in priority order, one per distinct page. */
function buildHeuristicUrls(owner: string, repo: string, homepage: string | null): string[] {
  const candidates: string[] = [];

  if (homepage) {
    const trimmed = homepage.endsWith("/") ? homepage.slice(0, -1) : homepage;
    candidates.push(`${trimmed}/docs`);
    candidates.push(`${homepage.endsWith("/") ? homepage : `${homepage}/`}docs/`);
    const domain = bareDomain(homepage);
    if (domain) candidates.push(`https://docs.${domain}`);
  }

  candidates.push(`https://${repo}.readthedocs.io`);
  candidates.push(`https://${repo}.gitbook.io`);
  candidates.push(`https://github.com/${owner}/${repo}/wiki`);

  const seen = new Set<string>();
  return candidates.filter((url) => {
    const key = dedupeKey(url);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fetch one candidate URL and reduce it to plain text, or `null` for
 * anything that isn't a fetchable, non-empty HTML page clearing
 * {@link MIN_CONTENT_CHARS} — a non-2xx response, a non-HTML content type, a
 * timeout, or a redirect/landing stub too short to be real content.
 */
async function fetchCandidate(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  try {
    const response = await fetch(parsed, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

    return text.length > MIN_CONTENT_CHARS ? text : null;
  } catch (error) {
    console.error(`[external-context] Heuristic fetch failed for ${url}: ${describe(error)}`);
    return null;
  }
}

/** Step A: try each heuristic URL in order, keep the first {@link MAX_HEURISTIC_HITS} real hits. */
async function fetchHeuristicDocs(
  owner: string,
  repo: string,
  homepage: string | null,
): Promise<{ text: string | null; sourceUrls: string[] }> {
  const candidates = buildHeuristicUrls(owner, repo, homepage);
  const kept: string[] = [];
  const sourceUrls: string[] = [];

  for (const url of candidates) {
    if (kept.length >= MAX_HEURISTIC_HITS) break;
    const text = await fetchCandidate(url);
    if (text) {
      kept.push(text);
      sourceUrls.push(url);
    }
  }

  if (kept.length === 0) return { text: null, sourceUrls };
  const combined = kept.join("\n\n").slice(0, MAX_DOCS_CHARS);
  return { text: combined, sourceUrls };
}

interface TavilyResult {
  url?: string;
  content?: string;
  raw_content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

/**
 * Run one Tavily search query. Any HTTP error, non-200 status, or malformed
 * JSON is treated as "no results" — Tavily is a supplement, never a hard
 * dependency, and a broken call here must not fail the whole function.
 *
 * A rejected key (401/403) is the one failure worth saying out loud, once per
 * process, in the same style as the "key absent" warning below: it returns
 * "no results" exactly like a genuinely empty search, so without this a
 * misconfigured or expired Tavily API key looks identical to "nothing was
 * found about this repo" — every profile silently losing its comparison
 * material with nothing in the logs to say why.
 */
async function tavilySearch(apiKey: string, query: string): Promise<{ text: string; urls: string[] }> {
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: TAVILY_MAX_RESULTS,
        include_raw_content: true,
      }),
    });
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && !warnedTavilyRejected) {
        warnedTavilyRejected = true;
        console.warn(
          `[external-context] Tavily rejected the configured API key (HTTP ${response.status}) — external context is falling back to URL-pattern heuristics only. Check the key at /admin/settings.`,
        );
      }
      return { text: "", urls: [] };
    }

    const data = (await response.json()) as TavilyResponse;
    const results = Array.isArray(data.results) ? data.results.slice(0, TAVILY_MAX_RESULTS) : [];

    const texts: string[] = [];
    const urls: string[] = [];
    for (const result of results) {
      const text = (result.raw_content ?? result.content ?? "").trim();
      if (text) texts.push(text);
      if (result.url) urls.push(result.url);
    }
    return { text: texts.join("\n\n"), urls };
  } catch (error) {
    console.error(`[external-context] Tavily search failed for "${query}": ${describe(error)}`);
    return { text: "", urls: [] };
  }
}

/**
 * Fetch supplementary docs/comparison text for a repo's profile article: a
 * URL-heuristic pass (always) plus a Tavily search pass (only when a Tavily
 * API key is configured at `/admin/settings`, and only for what heuristics
 * structurally can't find). Never throws — every sub-step degrades
 * independently to `null`/`[]`, matching the resilience style of
 * `fetchGithubRepoSource`.
 */
export async function fetchExternalContext({
  owner,
  repo,
  homepage,
}: FetchExternalContextParams): Promise<ExternalContextBundle> {
  const sourceUrls: string[] = [];

  const heuristics = await fetchHeuristicDocs(owner, repo, homepage);
  let docsText = heuristics.text;
  sourceUrls.push(...heuristics.sourceUrls);

  let comparisonText: string | null = null;

  const apiKey = await resolveTavilyApiKey();
  if (apiKey) {
    const queries: Array<{ kind: "docs" | "comparison"; query: string }> = [];
    if (docsText === null) {
      queries.push({ kind: "docs", query: `"${repo}" documentation` });
    }
    queries.push({ kind: "comparison", query: `"${repo}" vs alternatives comparison` });

    for (const { kind, query } of queries) {
      const { text, urls } = await tavilySearch(apiKey, query);
      if (!text) continue;
      const capped = text.slice(0, MAX_TAVILY_CHARS);
      if (kind === "docs") {
        docsText = docsText ? `${docsText}\n\n${capped}` : capped;
      } else {
        comparisonText = capped;
      }
      sourceUrls.push(...urls);
    }
  } else if (!warnedTavilyDisabled) {
    warnedTavilyDisabled = true;
    console.warn(
      "[external-context] No Tavily API key configured at /admin/settings — external context will use URL-pattern heuristics only.",
    );
  }

  return { docsText, comparisonText, sourceUrls };
}
