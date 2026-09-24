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

/** `owner/name` → its GitHub social-preview card URL. */
export function repoImageUrl(repo: string): string {
  const [owner, name] = repo.split("/");
  return `https://opengraph.githubassets.com/1/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** A model-written repo name resolved against the period's repos (lowercased name → canonical `owner/name`), or `null` if it isn't one of them. */
export function resolveRepo(name: string | undefined, repos: Map<string, string>): string | null {
  if (!name) return null;
  const cleaned = name.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/[`*]/g, "").replace(/\/+$/, "");
  return repos.get(cleaned.toLowerCase()) ?? null;
}
