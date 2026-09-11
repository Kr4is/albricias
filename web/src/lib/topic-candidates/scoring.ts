/**
 * Turning a fired candidate into a 0-100 score.
 *
 * Three components, each a whole number, summing to the total by construction
 * (the stored `scoreBreakdown` is meant to be checkable by addition, so nothing
 * here may round the total separately from its parts):
 *
 * - **substance (0-40)** — how far past its own trigger the candidate went.
 * - **originality (0-30)** — how rarely this kind fires, measured by replaying
 *   its own detector over prior periods.
 * - **narrative (0-30)** — a static per-kind weight for how much of a
 *   problem → attempt → resolution arc the kind inherently has.
 *
 * Every number here is a mechanical stand-in for a judgement an LLM would
 * otherwise make (the plan chose heuristics over a model call on purpose), and
 * every threshold is a starting point to be checked against real editions —
 * which is why they are named constants in one file rather than inline literals
 * spread across the detectors.
 *
 * Nothing in this module is random or time-dependent: the same stats scored
 * twice must produce the same number, or the stored candidates would appear to
 * change on their own.
 */

import type { GithubStats } from "@/lib/github-stats";
import { CURIOSITY_MAX_SIGNALS } from "./curiosity";
import { CANDIDATE_DETECTORS } from "./detectors";
import { clamp, describe } from "./shared";
import type { RawCandidate, ScoreBreakdown, TopicCandidateKind } from "./types";

const SUBSTANCE_MAX = 40;
const ORIGINALITY_MAX = 30;
const NARRATIVE_MAX = 30;

/**
 * How much story arc each kind carries before any of its data is looked at.
 *
 * `bugfixStory` and `release` lead because both come with a built-in
 * before/after — a thing was broken or unshipped, and then it wasn't.
 * `curiosity` trails everything by a wide margin: it is a fun fact, and the
 * gap is what stops the always-eligible fallback from beating a real story on
 * narrative weight alone. Revisit this table first if phase 2b ever replaces
 * the heuristics with a semantic pass.
 */
const NARRATIVE_WEIGHT: Readonly<Record<TopicCandidateKind, number>> = {
  bugfixStory: 30,
  release: 28,
  newLanguage: 22,
  externalContribution: 20,
  streak: 16,
  fastPrVelocity: 14,
  concentration: 12,
  curiosity: 5,
};

/**
 * The range each kind's `supporting` count is normalised over.
 *
 * `floor` is the detector's own trigger wherever the two are in the same unit:
 * clearing the bar is what earns a candidate its place in the list, and
 * substance points then measure how far *past* the bar it went. Where the
 * trigger is in a different unit (concentration triggers on a share but is
 * weighed on event count) the floor is a separate volume bar, noted below.
 *
 * `ceiling` is the point past which more of the same stops making the piece
 * any better to write — a sixtieth commit in the same repo adds nothing a
 * fortieth didn't.
 */
const SUBSTANCE_SCALE: Readonly<Record<TopicCandidateKind, { floor: number; ceiling: number }>> = {
  /** Events in the dominant repo. Floor is a volume bar, not the 40% trigger. */
  concentration: { floor: 5, ceiling: 60 },
  /** Consecutive days; floor is the 5-day trigger, ceiling three full weeks. */
  streak: { floor: 5, ceiling: 21 },
  /** Byte share as a percentage; floor is the 5% "genuinely picked up" bar. */
  newLanguage: { floor: 5, ceiling: 40 },
  /** PRs opened; floor is the 3-PR trigger. */
  fastPrVelocity: { floor: 3, ceiling: 15 },
  /** Issues closed plus `fix` commits; floor is the trigger's minimum sum (1 + 1). */
  bugfixStory: { floor: 2, ceiling: 20 },
  /** Releases published; floor is the single-release trigger. */
  release: { floor: 1, ceiling: 6 },
  /** External repos touched; floor is the single-repo trigger. */
  externalContribution: { floor: 1, ceiling: 5 },
  /**
   * Signals present. The ceiling is deliberately twice what the detector can
   * ever report, so even a curiosity carrying all three signals tops out at
   * half the substance points — a fun fact is not 800 words of material.
   */
  curiosity: { floor: 0, ceiling: CURIOSITY_MAX_SIGNALS * 2 },
};

/**
 * Originality for a kind with no prior periods to judge it against.
 *
 * Neutral rather than full marks: the first edition ever generated knows
 * nothing about what repeats, and handing every one of its candidates 30/30
 * would make its ranking a coin toss dressed as a measurement.
 */
const ORIGINALITY_WITHOUT_HISTORY = 15;

/** How far past its trigger a candidate went, as 0-40. */
export function computeSubstance(kind: TopicCandidateKind, supporting: number): number {
  const { floor, ceiling } = SUBSTANCE_SCALE[kind];
  if (ceiling <= floor) return 0;
  return Math.round(SUBSTANCE_MAX * clamp((supporting - floor) / (ceiling - floor), 0, 1));
}

/** The static per-kind arc weight, as 0-30. */
export function computeNarrativeWeight(kind: TopicCandidateKind): number {
  return NARRATIVE_WEIGHT[kind];
}

/**
 * How rare this kind is, as 0-30 — a kind that fired in every prior period
 * scores 0, one that fired in none scores 30.
 *
 * Works by replaying the kind's own detector over the prior periods' stored
 * stats, which is why no extra storage was needed for this: the answer to "did
 * this kind fire in March" is recomputable from March's own `githubStats`. Each
 * replay is handed the periods older than the one being replayed, so a detector
 * that compares against history (`newLanguage`) sees the history that period
 * would have seen rather than this period's.
 *
 * `thisPeriodFired` is a guard, not a weight: a kind that didn't fire has no
 * candidate to score, and returning 0 for it keeps a caller that asks anyway
 * from reading rarity as merit.
 */
export function computeOriginality(
  kind: TopicCandidateKind,
  thisPeriodFired: boolean,
  priors: GithubStats[],
): number {
  if (!thisPeriodFired) return 0;
  if (priors.length === 0) return ORIGINALITY_WITHOUT_HISTORY;

  const detect = CANDIDATE_DETECTORS[kind];
  let firedBefore = 0;
  for (const [index, prior] of priors.entries()) {
    try {
      if (detect(prior, priors.slice(index + 1))) firedBefore += 1;
    } catch (error) {
      // A prior period this detector can't read is not evidence of repetition,
      // so it counts as a period the kind didn't fire in rather than aborting.
      console.error(`[topic-candidates] Replaying ${kind} on a prior period failed: ${describe(error)}`);
    }
  }

  return Math.round(ORIGINALITY_MAX * (1 - firedBefore / priors.length));
}

/**
 * Score one fired candidate against the periods before it.
 *
 * The total is the sum of the three parts rather than a separately-rounded
 * figure, so `scoreBreakdown` always adds up to `score` exactly — the property
 * that makes a stored candidate arguable with rather than merely asserted.
 */
export function scoreCandidate(
  candidate: RawCandidate,
  priors: GithubStats[],
): { score: number; scoreBreakdown: ScoreBreakdown } {
  const scoreBreakdown: ScoreBreakdown = {
    substance: computeSubstance(candidate.kind, candidate.supporting),
    originality: computeOriginality(candidate.kind, true, priors),
    narrative: computeNarrativeWeight(candidate.kind),
  };

  return {
    score: scoreBreakdown.substance + scoreBreakdown.originality + scoreBreakdown.narrative,
    scoreBreakdown,
  };
}

export { NARRATIVE_MAX, ORIGINALITY_MAX, SUBSTANCE_MAX };
