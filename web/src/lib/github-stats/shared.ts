/**
 * Small helpers shared by more than one metric group in
 * `src/lib/github-stats/`. Anything used by exactly one group lives with that
 * group instead.
 */

import type { GithubStatsRow } from "./types";

/**
 * The event types that count as "the correspondent did work" for the temporal
 * and trend metrics.
 *
 * Deliberately narrower than "every GitHub row": `star`, `repo_created` and
 * `gist` say nothing about *when* someone was at the keyboard writing code, so
 * letting them into a streak or a busiest-day figure would inflate it with
 * bookmarking. `review` is excluded too — its `ServiceActivity.timestamp` is
 * the reviewed PR's `updated_at` (see the reviews block in
 * `@/lib/sources/github`), which can move long after the review was submitted,
 * so it is not a reliable clock reading.
 */
export const CONTRIBUTION_EVENT_TYPES = ["commit", "pr", "issue", "release"] as const;

const CONTRIBUTION_EVENT_SET: ReadonlySet<string> = new Set(CONTRIBUTION_EVENT_TYPES);

export function isContributionEvent(row: GithubStatsRow): boolean {
  return CONTRIBUTION_EVENT_SET.has(row.eventType);
}

/** `YYYY-MM-DD` in UTC, matching `@/lib/rankings/activity`'s convention. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const MS_PER_DAY = 86_400_000;

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Parse a stored JSON column into a plain object, or `null` for anything that
 * isn't one — a missing column, malformed JSON, or a bare scalar/array. Every
 * caller here reads optional enrichment out of `ServiceActivity.rawJson` or
 * `Edition.githubStats`, so a bad row must degrade that one metric rather than
 * abort the whole computation.
 */
export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Read a nested object off a parsed JSON value, or `null` if the path isn't an object. */
export function nestedObject(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a string field off a parsed JSON value, or `null` if it is absent or not a string. */
export function stringField(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse a GitHub ISO-8601 timestamp, or `null` for an absent or unparseable one. */
export function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `owner/name` → `owner`, or `null` for a repo string that isn't in that form. */
export function repoOwner(repo: string | null): string | null {
  if (!repo) return null;
  const owner = repo.split("/")[0];
  return owner && owner !== repo ? owner : null;
}

/**
 * Highest-count entry of a tally, ties broken by key so the same input always
 * yields the same "most X" answer (an arbitrary winner would make the stored
 * bank look like it changed between two identical recomputations).
 */
export function topEntry<K extends string | number>(counts: Map<K, number>): [K, number] | null {
  let best: [K, number] | null = null;
  for (const entry of counts) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && compareKeys(entry[0], best[0]) < 0)) {
      best = entry;
    }
  }
  return best;
}

/** Numeric order for numeric keys (so hour 9 precedes hour 10), lexical otherwise. */
function compareKeys<K extends string | number>(a: K, b: K): number {
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}
