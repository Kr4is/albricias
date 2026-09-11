/**
 * Detectors for the shape of the period's own work — where it went, how
 * sustained it was, and whether it was written in something new.
 *
 * All three read only `GithubStats`; none of them talks to the database or to
 * GitHub. `detectNewLanguage` is the one that needs prior periods, and it gets
 * them as an argument for the same reason `computeTrendStats` does: the
 * comparison is arithmetic, and arithmetic shouldn't need a database to be
 * reasoned about.
 */

import type { GithubStats, LanguageBytes } from "@/lib/github-stats";
import { count, nameList, percent, totalContributions } from "./shared";
import type { RawCandidate } from "./types";

/**
 * Share of the period's contributions that must land in one repo before
 * "everything happened in one place" is the story rather than a coincidence.
 *
 * The numerator counts *every* event type in that repo (that is what
 * `mostActiveRepo` tallies) while the denominator counts contributions only, so
 * a period spent mostly starring things can push the ratio past 1; it is
 * clamped rather than rejected, because a repo that out-counts the period's
 * whole contribution total is even more obviously the period's subject.
 */
const CONCENTRATION_MIN_SHARE = 0.4;

/** Consecutive contribution days that make a run worth narrating as a run. */
const STREAK_MIN_DAYS = 5;

/**
 * Byte share a language needs this period to count as genuinely picked up —
 * below this it is a config file or a vendored snippet, not a new tool.
 */
const NEW_LANGUAGE_MIN_SHARE = 0.05;

/**
 * Byte share that counts as "already there" in a prior period. Lower than the
 * bar above on purpose: the question a prior period answers is "had this
 * appeared at all", and a language that was already 2% of last month is not one
 * being discovered now.
 */
const PRIOR_LANGUAGE_PRESENCE_SHARE = 0.01;

/** One repo swallowed most of the period — a natural "what I've been building" piece. */
export function detectConcentration(stats: GithubStats): RawCandidate | null {
  const top = stats.volume.mostActiveRepo;
  const total = totalContributions(stats);
  if (!top || total === 0) return null;

  const share = Math.min(top.count / total, 1);
  if (share < CONCENTRATION_MIN_SHARE) return null;

  return {
    kind: "concentration",
    title: `What ${top.repo} took this period`,
    repos: [top.repo],
    bullets: [
      `${count(top.count, "event")} in ${top.repo}`,
      `${percent(share)}% of the period's ${count(total, "contribution")}`,
      stats.volume.distinctRepos > 1
        ? `${count(stats.volume.distinctRepos, "repository", "repositories")} touched in total, so the rest barely moved`
        : "the only repository touched all period",
    ],
    supporting: top.count,
  };
}

/** A long unbroken run of days — the "what kept me coming back" angle. */
export function detectStreak(stats: GithubStats): RawCandidate | null {
  const days = stats.temporal.longestStreakDays;
  if (days < STREAK_MIN_DAYS) return null;

  const top = stats.volume.mostActiveRepo;
  const busiest = stats.temporal.busiestDay;

  return {
    kind: "streak",
    title: `${count(days, "day")} in a row`,
    // The bank stores no per-day repo breakdown, so the period's busiest repo is
    // offered as the likely subject rather than asserted as the streak's cause.
    repos: top ? [top.repo] : [],
    bullets: [
      `${count(days, "consecutive day")} with at least one contribution`,
      top ? `most likely about ${top.repo} (${count(top.count, "event")} this period)` : null,
      busiest ? `busiest single day: ${busiest.date}, ${count(busiest.count, "contribution")}` : null,
    ].filter((bullet): bullet is string => bullet !== null),
    supporting: days,
  };
}

/**
 * A language that shows up this period and in none of the prior ones.
 *
 * Needs prior periods' full stored `language` group because the stats bank's
 * `trend` only carries contribution totals — there is no language history to
 * read off it. Returns `null` when no prior period has any language data at
 * all: with nothing to compare against, every language is trivially "new",
 * which would make the first edition ever generated claim a discovery it can't
 * support. A prior period whose language fetch failed is simply skipped, which
 * makes this heuristic err toward silence rather than toward a false first.
 */
export function detectNewLanguage(stats: GithubStats, priors: GithubStats[]): RawCandidate | null {
  const current = stats.language.topLanguagesByBytes;
  const history = priors.filter((prior) => prior.language.topLanguagesByBytes.length > 0);
  if (current.length === 0 || history.length === 0) return null;

  const total = totalBytes(current);
  if (total === 0) return null;

  for (const entry of [...current].sort((a, b) => b.bytes - a.bytes)) {
    const share = entry.bytes / total;
    if (share < NEW_LANGUAGE_MIN_SHARE) break;
    if (history.some((prior) => shareOf(prior.language.topLanguagesByBytes, entry.language) >= PRIOR_LANGUAGE_PRESENCE_SHARE)) {
      continue;
    }
    const others = current
      .filter((other) => other.language !== entry.language)
      .map((other) => other.language);

    return {
      kind: "newLanguage",
      title: `First ${entry.language} of the run`,
      // Language bytes are aggregated across every repo touched, so the bank
      // cannot say which repo introduced the language — better empty than guessed.
      repos: [],
      bullets: [
        `${entry.language} is ${percent(share)}% of this period's code by bytes`,
        `absent from the last ${count(history.length, "period")} with language data`,
        others.length > 0 ? `sitting alongside ${nameList(others)}` : null,
      ].filter((bullet): bullet is string => bullet !== null),
      supporting: share * 100,
    };
  }

  return null;
}

function totalBytes(languages: LanguageBytes[]): number {
  return languages.reduce((sum, entry) => sum + entry.bytes, 0);
}

/** A language's share of one period's bytes, `0` when it doesn't appear there. */
function shareOf(languages: LanguageBytes[], language: string): number {
  const total = totalBytes(languages);
  if (total === 0) return 0;
  const match = languages.find((entry) => entry.language.toLowerCase() === language.toLowerCase());
  return match ? match.bytes / total : 0;
}
