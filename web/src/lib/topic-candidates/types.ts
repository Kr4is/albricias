/**
 * Shared types for the topic-candidate layer (`src/lib/topic-candidates/`).
 *
 * Kept in one file for the same reason `src/lib/github-stats/types.ts` is: the
 * detector modules are deliberately independent of each other and only
 * `./index.ts` knows about all of them at once, so none of them should have to
 * import sideways from a sibling just to name its own output.
 *
 * The distinction between {@link RawCandidate} and {@link TopicCandidate} is
 * load-bearing: detection answers "is there a story here", scoring answers "how
 * much is it worth", and keeping them apart is what lets
 * `computeOriginality` re-run a detector against a prior period without
 * dragging that period's scoring along with it.
 */

import type { GithubStats } from "@/lib/github-stats";

/** The kinds in `Edition.topicCandidates`'s doc comment — that comment is the authority. */
export type TopicCandidateKind =
  | "concentration"
  | "streak"
  | "newLanguage"
  | "fastPrVelocity"
  | "bugfixStory"
  | "release"
  | "externalContribution"
  | "curiosity";

/**
 * What a detector produces when its kind fires: the story, the data behind it,
 * and one number standing in for "how much material there is".
 */
export interface RawCandidate {
  kind: TopicCandidateKind;
  /** A working angle, not a headline — whoever writes the piece renames it. */
  title: string;
  /** `owner/name` repos the candidate is about; empty when the bank can't say which. */
  repos: string[];
  /** 2-3 facts re-derivable by hand from the same `githubStats`. Never empty. */
  bullets: string[];
  /**
   * The quantity {@link RawCandidate.kind}'s substance score is measured on —
   * PRs, streak days, byte share, … The unit differs per kind on purpose (a
   * release and a streak aren't countable in the same currency), so it is only
   * ever read through that kind's entry in `./scoring`'s substance scale.
   */
  supporting: number;
}

/** The three components of a candidate's score; they sum to `score`, by construction. */
export interface ScoreBreakdown {
  /** 0-40 — how far past its own trigger this candidate went. */
  substance: number;
  /** 0-30 — how rarely this kind fires, measured against prior periods. */
  originality: number;
  /** 0-30 — the static per-kind story arc weight, see `./scoring`. */
  narrative: number;
}

/** One entry of the stored `Edition.topicCandidates` array. */
export interface TopicCandidate {
  kind: TopicCandidateKind;
  title: string;
  repos: string[];
  bullets: string[];
  /** 0-100, the sum of {@link TopicCandidate.scoreBreakdown}'s three parts. */
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

/**
 * Every detector has this shape, including the ones that ignore `priors`.
 *
 * The uniformity is what makes the originality component possible at all: the
 * scorer re-runs an arbitrary kind's own trigger against an arbitrary prior
 * period, and can only do that if it doesn't need to know which kind it holds.
 * `priors` is newest-first and, when a detector is being replayed against a
 * prior period, contains only the periods older than *that* one — so a replay
 * sees the same history the original run would have seen.
 */
export type CandidateDetector = (stats: GithubStats, priors: GithubStats[]) => RawCandidate | null;
