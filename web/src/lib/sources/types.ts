/**
 * Shared shapes for every activity source (GitHub, blog RSS, Spotify) and for
 * the assisted-generation input processors (audio, text).
 *
 * Ported from the Flask app's implicit "activity dict" contract
 * (`app/services/github.py`, `app/services/spotify.py`) and from
 * `app/services/sources/__init__.py` (`SourceResult`).
 *
 * The dict keys are camelCased here so an `ActivityItem` maps 1:1 onto the
 * Prisma `ServiceActivity` model; the `eventType` *values* are unchanged from
 * Python so `chronicle`'s `EVENT_CATEGORY_MAP` still groups them identically.
 */

/** Value of `ServiceActivity.source`. */
export type ActivitySource = "github" | "blog" | "spotify";

/**
 * One normalised external event, ready to be written as a `ServiceActivity`
 * row (`raw` goes to `rawJson` after `JSON.stringify`).
 */
export interface ActivityItem {
  source: ActivitySource;
  /**
   * `commit` | `pr` | `review` | `issue` | `release` | `repo_created` |
   * `gist` | `star` | `blog_post` | `spotify_track` | `spotify_artist` |
   * `spotify_played`.
   */
  eventType: string;
  /** `owner/name` for GitHub repo-scoped events; `null` everywhere else. */
  repo: string | null;
  title: string;
  url: string | null;
  timestamp: Date | null;
  /** Original API payload, stored verbatim for later re-processing. */
  raw: unknown;
}

/**
 * A half-open period `[periodStart, periodEnd)`, matching
 * `Edition.periodStart` / `Edition.periodEnd` (the end is exclusive).
 */
export interface Period {
  periodStart: Date;
  periodEnd: Date;
}

/** `true` when `date` falls inside the half-open period. */
export function inPeriod(date: Date | null, period: Period): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= period.periodStart.getTime() && t < period.periodEnd.getTime();
}

/** `true` when `date` is strictly before the period — used for early-exit. */
export function beforePeriod(date: Date | null, period: Period): boolean {
  return date !== null && date.getTime() < period.periodStart.getTime();
}

/** Lenient ISO-8601 parse; returns `null` for missing/unparseable input. */
export function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// Assisted-generation input processors
// ---------------------------------------------------------------------------

/** Ported from `SOURCES` in `app/services/sources/__init__.py`. */
export type SourceType =
  | "audio_monologue"
  | "audio_conversation"
  | "text"
  | "notes";

export const SOURCES: Record<SourceType, string> = {
  audio_monologue: "Audio — Monologue",
  audio_conversation: "Audio — Conversation / Interview",
  text: "Text / Transcription",
  notes: "Notes / Bullet Points",
};

/** Normalized output from any source processor. */
export interface SourceResult {
  text: string;
  sourceType: SourceType;
  metadata: Record<string, unknown>;
}
