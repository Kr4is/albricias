/**
 * Ranking article generators — Phase C of the agent-editions plan.
 *
 * Barrel for `web/src/lib/rankings/*`. Down to two kinds now — the
 * admin-triggered-only Best-Of Digest and generic "top N of `<field>`"
 * builder (formerly `./best-of.ts`/`./generic.ts`) were deleted along with
 * their manual-only UI (`articles/rank/page.tsx`) as part of the app's
 * AI-first admin simplification: neither had an automatic equivalent, so
 * removing the manual trigger removed the capability entirely — a
 * deliberate choice, not an oversight. (Old published editions may still
 * reference a `"best-of-digest"` article created before this change; see
 * `@/lib/synthesis/load.ts`'s generator-kind list, left as-is since it only
 * *reads* whatever already exists.)
 *
 * The two kinds left, each a pure-TS computation over already-stored rows
 * plus one `NEWSPAPER_PERSONA`-voiced LLM call, both wired into the
 * automatic edition-generation pipeline (`populateEditionDraft` in
 * `@/lib/generation`) and retriable from the edit page if they fail (see
 * `computeMissingGenerationPieces`/`beginActivityRankingRetry` in the same
 * file):
 *
 *   1. {@link createActivityRankingArticle} — GitHub activity/productivity
 *      ranking (busiest days, event-type breakdown, most-used languages).
 *   2. {@link createCalendarRankingArticle} — Google Calendar stats ranking
 *      (event count, hours, busiest day, day-of-week distribution), Phase F
 *      of the google-calendar-alexandria-sources plan. Structurally
 *      excludes event titles/descriptions (see `./calendar.ts`'s doc
 *      comment).
 */

export { RANKING_CATEGORY } from "./shared";

export {
  type ActivityRankingComputation,
  type ActivityRankingInput,
  type ActivityRankingRow,
  type DayCount,
  type EventTypeCount,
  type LanguageBytes,
  aggregateLanguages,
  computeActivityRanking,
  createActivityRankingArticle,
  fetchRepoLanguages,
  narrateActivityRanking,
} from "./activity";

export {
  type CalendarDayCount,
  type CalendarRankingComputation,
  type CalendarRankingInput,
  type DayOfWeekCount,
  computeCalendarRanking,
  createCalendarRankingArticle,
  narrateCalendarRanking,
} from "./calendar";
