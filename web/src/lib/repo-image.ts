/**
 * Real repository imagery for the front page — GitHub's own social-preview
 * card, never a generated picture. `opengraph.githubassets.com` serves one
 * for every public repo and sends `access-control-allow-origin: *`, so it
 * works both as a plain `<img>` and inside the canvas export without
 * tainting it.
 *
 * The URL is only ever *built* here, never fetched: the endpoint is
 * rate-limited per source IP (100/hour), so each visitor's own browser must
 * load it directly — fetching server-side would share one budget across
 * every visitor.
 */

import type { ActivityItem } from "@/lib/sources/types";

/** `owner/name` → its GitHub social-preview card URL. */
export function repoImageUrl(repo: string): string {
  const [owner, name] = repo.split("/");
  return `https://opengraph.githubassets.com/1/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/**
 * Lowercased name → canonical `owner/name`, for every repo the period's
 * activity actually mentions — the whitelist a model-written `REPO:` line is
 * checked against, so a misspelled or invented name yields no image rather
 * than a broken link.
 */
export function knownRepos(activity: ActivityItem[]): Map<string, string> {
  const repos = new Map<string, string>();
  for (const item of activity) {
    if (item.repo && item.repo.includes("/")) repos.set(item.repo.toLowerCase(), item.repo);
  }
  return repos;
}

/** A model-written repo name resolved against `knownRepos`, or `null` if it isn't one of them. */
export function resolveRepo(name: string | undefined, repos: Map<string, string>): string | null {
  if (!name) return null;
  const cleaned = name.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/[`*]/g, "").replace(/\/+$/, "");
  return repos.get(cleaned.toLowerCase()) ?? null;
}
