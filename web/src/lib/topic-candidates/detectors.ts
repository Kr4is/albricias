/**
 * The registry that turns "a kind" into "the check that decides it".
 *
 * It exists so nothing else has to hold a switch over the eight kinds: the
 * orchestrator runs every entry once, and the originality scorer looks one
 * entry up and replays it against prior periods. Adding a kind means adding a
 * detector and one line here — the alternative, a per-kind branch in both
 * places, is exactly how the two would drift out of agreement about which
 * checks exist.
 */

import { detectConcentration, detectNewLanguage, detectStreak } from "./activity";
import {
  detectBugfixStory,
  detectExternalContribution,
  detectFastPrVelocity,
  detectRelease,
} from "./collaboration";
import { detectCuriosity } from "./curiosity";
import type { CandidateDetector, TopicCandidateKind } from "./types";

export const CANDIDATE_DETECTORS: Readonly<Record<TopicCandidateKind, CandidateDetector>> = {
  concentration: (stats) => detectConcentration(stats),
  streak: (stats) => detectStreak(stats),
  newLanguage: (stats, priors) => detectNewLanguage(stats, priors),
  fastPrVelocity: (stats) => detectFastPrVelocity(stats),
  bugfixStory: (stats) => detectBugfixStory(stats),
  release: (stats) => detectRelease(stats),
  externalContribution: (stats) => detectExternalContribution(stats),
  curiosity: (stats) => detectCuriosity(stats),
};

/**
 * Fixed iteration order. Object key order would work today but isn't something
 * to lean on for a value that gets stored and diffed across runs; this also
 * doubles as the tie-break order when two candidates score identically.
 */
export const CANDIDATE_KINDS: readonly TopicCandidateKind[] = [
  "bugfixStory",
  "release",
  "newLanguage",
  "externalContribution",
  "streak",
  "fastPrVelocity",
  "concentration",
  "curiosity",
];
