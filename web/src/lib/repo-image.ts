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

/** Edits (insertions, deletions, substitutions) between two strings. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** A misspelling this close to exactly one real name is taken as that name — a model copying `JuliusBrussee` as `JuliusBrusese`. */
const MAX_TYPO_EDITS = 2;

/**
 * A model-written repo name resolved against the period's repos (lowercased
 * name → canonical `owner/name`), or `null` if it isn't one of them. Exact
 * first; then a bare `name` matching exactly one repo; then a near-miss
 * spelling of exactly one.
 */
export function resolveRepo(name: string | undefined, repos: Map<string, string>): string | null {
  if (!name) return null;
  const cleaned = name.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/[`*]/g, "").replace(/\/+$/, "").toLowerCase();
  if (!cleaned) return null;
  const exact = repos.get(cleaned);
  if (exact) return exact;
  const only = (matches: string[]) => (matches.length === 1 ? repos.get(matches[0])! : null);
  const keys = [...repos.keys()];
  if (!cleaned.includes("/")) return only(keys.filter((key) => key.split("/")[1] === cleaned));
  return only(keys.filter((key) => editDistance(key, cleaned) <= MAX_TYPO_EDITS));
}
