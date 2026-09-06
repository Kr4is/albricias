/**
 * Ranking article generators — Phase C of the agent-editions plan.
 *
 * Barrel for `web/src/lib/rankings/*` — three ranking kinds, each a pure-TS
 * computation over already-stored rows plus one `NEWSPAPER_PERSONA`-voiced
 * LLM call:
 *
 *   1. {@link createActivityRankingArticle} — GitHub activity/productivity
 *      ranking (busiest days, event-type breakdown, most-used languages).
 *      Wired into the automatic edition-generation pipeline
 *      (`runEditionGeneration` in `@/lib/generation`) *and* available as an
 *      admin action.
 *   2. {@link createBestOfDigestArticle} — "best of last period" digest,
 *      admin-triggered only (needs a prior published edition).
 *   3. {@link createGenericRankingArticle} — the generic "top N of `<field>`"
 *      builder, admin-triggered only (inherently a manual/configurable
 *      action).
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
  type BestOfInput,
  createBestOfDigestArticle,
  narrateBestOf,
} from "./best-of";

export {
  type GenericRankingNarrationInput,
  type GenericRankingOptions,
  type GenericRankingRow,
  type RankableField,
  type RankableModel,
  RANKABLE_FIELDS,
  computeGenericRanking,
  createGenericRankingArticle,
  findRankableField,
  narrateGenericRanking,
} from "./generic";
