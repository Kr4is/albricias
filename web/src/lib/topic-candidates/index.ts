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
import type { RawCandidate, TopicCandidate, TopicCandidateKind } from "./types";

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

  candidates.forEach((candidate, index) => {
    try {
      const { score, scoreBreakdown } = scoreCandidate(candidate, priors);
      scored.push({
        // `kind` alone can repeat (different repos, same kind), so `index` —
        // this candidate's position in the pre-sort `candidates` array, which
        // follows `CANDIDATE_KINDS` order — is what makes the id unique. See
        // the doc comment on `TopicCandidate.id`.
        id: `${candidate.kind}-${index}`,
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

function kindOrder(kind: TopicCandidateKind): number {
  return CANDIDATE_KINDS.indexOf(kind);
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

export {
  type CandidateDetector,
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
