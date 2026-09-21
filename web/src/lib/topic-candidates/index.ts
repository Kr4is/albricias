/**
 * Topic candidates — phase 2 of `.omc/plans/github-topic-candidates.md`.
 *
 * Phase 1 computes what is *true* about an edition's GitHub period
 * (`@/lib/github-stats`). This decides what is *worth writing about*: it runs
 * eight independent heuristics over that stats bank, scores whichever of them
 * fired, and returns a ranked shortlist for the array stored in
 * `Edition.topicCandidates`, whose doc comment in `prisma/schema.prisma` is the
 * authority on the shape.
 *
 * These are candidates, not articles, and not a decision — the existing
 * chronicle columns still cover the period's routine activity unconditionally.
 * What this adds is the one thing per period that might deserve a deliberate,
 * single-focus piece, ranked so a human can see the runners-up and disagree.
 *
 * No LLM call anywhere in this module (the plan chose heuristics over semantic
 * grouping deliberately), so like phase 1 it costs nothing and runs whether or
 * not an AI provider is configured. And like phase 1,
 * {@link computeTopicCandidates} never throws: it is called from
 * `populateEditionDraft`, where an optional enrichment failing must cost at
 * most itself. A detector that blows up loses its own candidate, not the list.
 */

import type { GithubStats } from "@/lib/github-stats";
import { prisma } from "@/lib/prisma";
import { CANDIDATE_DETECTORS, CANDIDATE_KINDS } from "./detectors";
import { scoreCandidate } from "./scoring";
import { describe } from "./shared";
import type { CuratedArticleKind, RawCandidate, TopicCandidate, TopicCandidateKind } from "./types";

/**
 * How far back originality looks — the same year-of-monthly-editions window
 * `@/lib/github-stats` uses for its trend group, for the same reason: it is
 * long enough for "this hasn't happened in months" to mean something, and it
 * keeps the query bounded however long the paper has been running.
 */
const MAX_PRIOR_PERIODS = 12;

/**
 * The user's own stated "3-5 highlights" range, taken at its upper bound. The
 * point of storing the runners-up rather than only the winner is that the
 * ranking is a heuristic and should be overridable by whoever reads it.
 */
const MAX_CANDIDATES = 5;

/**
 * Ranked topic candidates for `editionId`, or `null` when the edition has no
 * stored `githubStats`.
 *
 * That `null` is the same contract phase 1 established and is load-bearing:
 * a period with no GitHub activity has nothing to propose, and an empty array
 * would say "we looked and found nothing interesting" about a period we never
 * looked at. When `githubStats` *is* present the result is never empty —
 * `curiosity` is always eligible (see `./curiosity`).
 */
export async function computeTopicCandidates(editionId: number): Promise<TopicCandidate[] | null> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { id: true, cadence: true, periodStart: true, githubStats: true },
  });
  if (!edition) return null;

  const stats = parseStoredStats(edition.githubStats);
  if (!stats) return null;

  const priors = await loadPriorStats(edition.id, edition.cadence, edition.periodStart);
  return rankCandidates(collectCandidates(stats, priors), priors);
}

/**
 * One `TopicCandidate` per starred repo in the edition's period — computed
 * straight from `ServiceActivity` (`eventType: "star"`), independently of
 * {@link computeTopicCandidates} and its `githubStats`-derived detectors.
 *
 * Unlike the eight detector kinds, every star qualifies: the admin already
 * made the judgment call by starring the repo, so there is nothing here for a
 * heuristic to score. `score: 100` is a fixed "always qualifies" marker, not
 * a value comparable to a detector kind's 0-100 heuristic score — see
 * `generateTopicCandidateArticles`'s explicit `kind === "star"` bypass of the
 * score threshold in `@/lib/generation`. `scoreBreakdown` is present only to
 * satisfy {@link TopicCandidate}'s shape and carries no meaning for this kind.
 *
 * Returns `[]` (never throws) for an edition with no starred repos, matching
 * `computeTopicCandidates`'s "never let a bug here break the rest of
 * generation" contract — the caller in `populateEditionDraft` merges this
 * into the same `Edition.topicCandidates` array.
 *
 * `since`, when given, narrows the query to stars at or after that instant —
 * how `@/lib/generation/daily`'s per-day job asks "which stars are new
 * today" without re-surfacing a star from an earlier day the merge in
 * `mergeTopicCandidates` already recorded.
 */
export async function computeStarCandidates(
  editionId: number,
  { since }: { since?: Date } = {},
): Promise<TopicCandidate[]> {
  const stars = await prisma.serviceActivity.findMany({
    where: { editionId, eventType: "star", ...(since ? { timestamp: { gte: since } } : {}) },
  });

  return stars
    .filter((star) => star.repo)
    .map((star) => {
      const repo = star.repo as string;
      const name = repo.split("/")[1] ?? repo;
      // Sanitized: this id is a Next.js dynamic route segment
      // (`.../topic-candidates/[candidateId]/toggle`), so it must not
      // contain "/" — `repo` always does (`owner/name`).
      const id = `star-${repo.replace(/\//g, "__")}`;
      const bullets = [star.title, star.url].filter((value): value is string => Boolean(value));
      return {
        id,
        kind: "star" as const,
        title: name,
        repos: [repo],
        bullets: bullets.length > 0 ? bullets : [repo],
        score: 100,
        scoreBreakdown: { substance: 0, originality: 0, narrative: 0 },
      };
    });
}

/**
 * Run every detector once, isolating failures.
 *
 * Exported because it is the whole of the heuristic layer with none of the
 * database in the way: given a stats bank and its history it answers "what
 * fired", which is the part worth exercising directly against synthetic data.
 */
export function collectCandidates(stats: GithubStats, priors: GithubStats[]): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  for (const kind of CANDIDATE_KINDS) {
    try {
      const candidate = CANDIDATE_DETECTORS[kind](stats, priors);
      if (candidate) candidates.push(candidate);
    } catch (error) {
      console.error(`[topic-candidates] Detector ${kind} failed: ${describe(error)}`);
    }
  }

  return candidates;
}

/**
 * Score, sort, and cut to {@link MAX_CANDIDATES}.
 *
 * Ties break on {@link CANDIDATE_KINDS} order rather than on whatever order the
 * detectors happened to run in, so two candidates on the same score always land
 * the same way round — the stored list is diffed across runs, and a ranking
 * that shuffled itself would read as the data having changed.
 */
export function rankCandidates(candidates: RawCandidate[], priors: GithubStats[]): TopicCandidate[] {
  const scored: TopicCandidate[] = [];

  candidates.forEach((candidate) => {
    try {
      const { score, scoreBreakdown } = scoreCandidate(candidate, priors);
      scored.push({
        // Content-derived, not positional — the daily-incremental generation
        // pipeline (`@/lib/generation/daily`) re-runs this over a growing,
        // still-open period every day, and a positional `${kind}-${index}`
        // id (the original scheme) would silently reassign itself whenever a
        // later day's detectors fired in a different order, breaking curator
        // marks and `findArticleForTopicCandidate`'s lookup (see that
        // function's doc comment for the duplicate-article bug this exact
        // instability caused elsewhere before it was id-stabilized). Repo-
        // scoped kinds reuse `computeStarCandidates`'s own
        // `star-${repo}`-with-slashes-sanitized convention (the id is a
        // Next.js dynamic route segment); `curiosity`, the one kind with no
        // repo, is a fixed singleton — see `mergeTopicCandidates` for the
        // other half of why this matters (merge, never overwrite).
        id:
          candidate.repos.length > 0
            ? `${candidate.kind}-${candidate.repos[0].replace(/\//g, "__")}`
            : candidate.kind,
        kind: candidate.kind,
        title: candidate.title,
        repos: candidate.repos,
        bullets: candidate.bullets,
        score,
        scoreBreakdown,
      });
    } catch (error) {
      console.error(`[topic-candidates] Scoring ${candidate.kind} failed: ${describe(error)}`);
    }
  });

  return scored
    .sort((a, b) => b.score - a.score || kindOrder(a.kind) - kindOrder(b.kind))
    .slice(0, MAX_CANDIDATES);
}

/**
 * `scored`'s `kind` field is typed as the wider `CuratedArticleKind`
 * (`TopicCandidate.kind`'s declared type) even though every value pushed
 * into it here came from a `RawCandidate` (one of the eight real detector
 * kinds only — `"star"` candidates are built directly in
 * `computeStarCandidates` and never pass through `rankCandidates`). The cast
 * reflects that invariant rather than changing it.
 */
function kindOrder(kind: CuratedArticleKind): number {
  return CANDIDATE_KINDS.indexOf(kind as TopicCandidateKind);
}

/**
 * Merge a fresh computation into the candidates already stored on the
 * edition — additive, never a wholesale overwrite. A candidate whose id is
 * already in `existing` is replaced in place (its content can genuinely
 * improve day to day — a `streak` running longer, say); a new id is
 * appended; critically, an id in `existing` that this run's detectors
 * didn't reproduce is **never dropped**, because an article may already
 * point at it (`Article.sourceData.topicCandidateId`,
 * `findArticleForTopicCandidate` in `@/lib/generation`) and losing the
 * candidate would orphan that lookup. `MAX_CANDIDATES` capping happens per
 * run inside {@link rankCandidates}, before candidates ever reach here —
 * that's a ranking/display concern; this function's job is never to lose
 * data once it's been surfaced.
 */
export function mergeTopicCandidates(
  existing: TopicCandidate[],
  fresh: TopicCandidate[],
): TopicCandidate[] {
  const merged = [...existing];
  for (const candidate of fresh) {
    const index = merged.findIndex((c) => c.id === candidate.id);
    if (index === -1) {
      merged.push(candidate);
    } else {
      merged[index] = candidate;
    }
  }
  return merged;
}

/**
 * Earlier same-cadence editions' *full* stored stats banks, newest first.
 *
 * Same query shape as `loadPriorSummaries` in `@/lib/github-stats`, but keeping
 * the whole object instead of reducing it to a contribution total: originality
 * replays arbitrary detectors over these periods, and `newLanguage` in
 * particular needs their `language` group — which the phase-1 `PeriodSummary`
 * does not carry. Cadence is part of the filter for the reason it is there:
 * a weekly period and a monthly one aren't comparable quantities, so a weekly
 * edition must not be told its streak is unremarkable because monthly ones
 * clear the same bar.
 */
async function loadPriorStats(
  editionId: number,
  cadence: string,
  periodStart: Date,
): Promise<GithubStats[]> {
  try {
    const editions = await prisma.edition.findMany({
      where: {
        id: { not: editionId },
        cadence,
        periodStart: { lt: periodStart },
        githubStats: { not: null },
      },
      orderBy: { periodStart: "desc" },
      take: MAX_PRIOR_PERIODS,
      select: { githubStats: true },
    });
    return editions
      .map((e) => parseStoredStats(e.githubStats))
      .filter((stats): stats is GithubStats => stats !== null);
  } catch (error) {
    console.error(`[topic-candidates] Prior-period lookup failed: ${describe(error)}`);
    return [];
  }
}

/** The groups a stats bank must carry to be worth running detectors over. */
const REQUIRED_GROUPS = ["temporal", "volume", "collaboration", "content", "language"] as const;

/**
 * Read a stored `Edition.githubStats` string into a stats bank, or `null` for
 * anything unreadable — malformed JSON, a hand-edited row, or a bank written
 * before one of the groups existed.
 *
 * Only the presence of the five groups is checked, not every field inside them:
 * the group types already declare several fields optional on purpose ("GitHub
 * didn't tell us" is distinct from zero), and every detector is written to
 * treat a missing field as "this kind doesn't fire". A bank missing a whole
 * group is dropped rather than patched with empty defaults, which is the same
 * call `parseStoredSummary` makes in phase 1: a prior period we can't read is
 * not a prior period in which nothing happened.
 */
export function parseStoredStats(stored: string | null | undefined): GithubStats | null {
  if (!stored) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const complete = REQUIRED_GROUPS.every((group) => {
    const value = record[group];
    return typeof value === "object" && value !== null && !Array.isArray(value);
  });

  return complete ? (parsed as GithubStats) : null;
}

/**
 * Read a stored `Edition.topicCandidates` string into its array, or `[]` for
 * anything unreadable.
 *
 * The mirror of {@link parseStoredStats} for the other column this module
 * writes, and deliberately more forgiving than it: a candidate list is a
 * ranked shortlist whose consumers all iterate it, so "we can't read it" and
 * "nothing was proposed" are the same thing to them, whereas a stats bank's
 * `null` genuinely means "we never looked".
 */
export function parseStoredTopicCandidates(
  stored: string | null | undefined,
): TopicCandidate[] {
  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as TopicCandidate[]) : [];
  } catch {
    return [];
  }
}

/** `Edition.curatorMarks`'s stored shape — see the doc comment in `prisma/schema.prisma`. */
export interface CuratorMarks {
  topicCandidateIds?: string[];
  githubStatKeys?: string[];
}

/**
 * Read a stored `Edition.curatorMarks` string into its object, or `{}` for
 * anything unreadable — malformed JSON, a hand-edited row, or a non-object.
 *
 * `{}` is the "nothing has been curated yet" value, which is exactly what an
 * unreadable column should degrade to: see {@link isTopicCandidateMarked} for
 * why that means "everything is marked" rather than "nothing is".
 */
export function parseStoredCuratorMarks(raw: string | null | undefined): CuratorMarks {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CuratorMarks)
      : {};
  } catch {
    return {};
  }
}

/**
 * `topicCandidateIds === undefined` (curatorMarks never touched, or this
 * field never written to it) means "every candidate is marked/visible" — the
 * default before any curation action, matching `Article.hidden`'s own default
 * of `false`. Once the array exists, membership is authoritative (see
 * `.../topic-candidates/[candidateId]/toggle/route.ts` for how it gets
 * populated in full on the first unmark).
 */
export function isTopicCandidateMarked(marks: CuratorMarks, candidateId: string): boolean {
  return marks.topicCandidateIds === undefined || marks.topicCandidateIds.includes(candidateId);
}

export {
  type CandidateDetector,
  type CuratedArticleKind,
  type RawCandidate,
  type ScoreBreakdown,
  type TopicCandidate,
  type TopicCandidateKind,
} from "./types";

export { detectConcentration, detectNewLanguage, detectStreak } from "./activity";
export {
  detectBugfixStory,
  detectExternalContribution,
  detectFastPrVelocity,
  detectRelease,
} from "./collaboration";
export { detectCuriosity } from "./curiosity";
export { CANDIDATE_DETECTORS, CANDIDATE_KINDS } from "./detectors";
export {
  computeNarrativeWeight,
  computeOriginality,
  computeSubstance,
  scoreCandidate,
} from "./scoring";
