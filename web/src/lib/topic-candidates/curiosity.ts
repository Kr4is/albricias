/**
 * The fallback detector — the one kind that is always eligible.
 *
 * Its job is structural, not editorial: a period with real GitHub activity but
 * no strong signal (one quiet commit, no PRs, no streak, nothing shipped) must
 * still yield a non-empty candidate list, because an empty list is
 * indistinguishable from "the computation failed" to everything downstream.
 * So {@link detectCuriosity} never returns `null` — when none of the curiosity
 * signals is present it falls back to the period's bare volume, which exists
 * whenever `githubStats` does.
 *
 * The scoring side is what keeps this from crowding out real stories: curiosity
 * carries the lowest narrative weight, its substance ceiling is set so even a
 * fully-signalled curiosity claims only half the available points, and because
 * it fires every period its originality decays to nothing. It wins only when
 * nothing else fired.
 */

import type { GithubStats } from "@/lib/github-stats";
import { count, totalContributions } from "./shared";
import type { RawCandidate } from "./types";

/**
 * Hours whose commit activity is worth remarking on. Bounded by the same
 * reading of the clock `github-stats`'s `lateNight` bucket uses (the small
 * hours), extended upward through the late evening — 22:00 commits are the same
 * "still at it" observation as 02:00 ones, just on the other side of midnight.
 */
const ODD_HOUR_FROM = 22;
const ODD_HOUR_UNTIL = 6;

/** Emoji, unusual message, odd hour — the most `supporting` a curiosity can report. */
export const CURIOSITY_MAX_SIGNALS = 3;

const FALLBACK_TITLE = "Odds and ends from the log";

function isOddHour(hour: number): boolean {
  return hour >= ODD_HOUR_FROM || hour < ODD_HOUR_UNTIL;
}

function utcHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * A fun fact about the period, built from whichever of the odd-hour / emoji /
 * unusual-message signals survived the stats computation.
 *
 * Signals are collected in a fixed order so the same stats always produce the
 * same title and the same bullets — the candidate list is stored and compared
 * across runs, and a fallback that reshuffled itself would look like the data
 * had changed when it hadn't.
 */
export function detectCuriosity(stats: GithubStats): RawCandidate {
  const hour = stats.temporal.mostProductiveHour;
  const oddHour = hour && isOddHour(hour.hour) ? hour : null;
  const emoji = stats.content.mostUsedEmoji;
  const unusual = stats.content.mostUnusualCommitMessage;

  const signals: Array<{ title: string; bullet: string }> = [];
  if (oddHour) {
    signals.push({
      title: `What gets written at ${utcHour(oddHour.hour)}`,
      bullet: `most commits land in the ${utcHour(oddHour.hour)} UTC hour (${count(oddHour.count, "commit")})`,
    });
  }
  if (emoji) {
    signals.push({
      title: `A period told in ${emoji.emoji}`,
      bullet: `${emoji.emoji} appears in ${count(emoji.count, "commit message")}`,
    });
  }
  if (unusual) {
    signals.push({
      title: "The commit message that doesn't fit",
      bullet: `the period's most out-of-character subject line: "${unusual}"`,
    });
  }

  if (signals.length === 0) {
    // No texture at all — state what is always true of a non-null stats bank
    // rather than inventing a signal, and let the score show how thin it is.
    return {
      kind: "curiosity",
      title: FALLBACK_TITLE,
      repos: [],
      bullets: [
        `${count(totalContributions(stats), "contribution")} across ${count(stats.volume.distinctRepos, "repository", "repositories")}`,
      ],
      supporting: 0,
    };
  }

  return {
    kind: "curiosity",
    title: signals[0].title,
    // Curiosity signals are period-wide (an hour, an emoji, one message the bank
    // stores without its repo), so there is no repo to attribute them to.
    repos: [],
    bullets: signals.map((signal) => signal.bullet),
    supporting: signals.length,
  };
}
