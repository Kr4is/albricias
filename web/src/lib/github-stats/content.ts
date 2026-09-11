/**
 * Commit-message metrics — the texture of the period's writing, not its volume.
 *
 * The input is `ServiceActivity.title`, which for a `commit` row is the first
 * line of the message capped at 200 characters (`@/lib/sources/github`'s
 * commit block). So every length figure here is a *subject line* length, not a
 * full message length, and a subject at exactly 200 characters may have been
 * truncated — worth knowing before anyone reads "longest commit message" as
 * literal.
 *
 * Pure function, no I/O, never throws.
 */

import { topEntry } from "./shared";
import type { ContentStats, GithubStatsRow, KeywordCount } from "./types";

/**
 * Conventional-commit types recognised in a subject's leading token. Anything
 * else — `wip`, a bare sentence, a scope-only prefix — is left uncounted
 * rather than invented as a category, so the breakdown adds up to "messages
 * that followed the convention", which is the interesting number.
 */
const CONVENTIONAL_TYPES: ReadonlySet<string> = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "feature",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
]);

/** Any pictographic character — the gitmoji convention's alphabet. */
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;

/**
 * Leading emoji, whitespace and the joiner/variation-selector glue that binds a
 * composite emoji together — stripped before the conventional-type check so a
 * gitmoji-prefixed `✨ feat: x` is still counted as a `feat`.
 */
const LEADING_DECORATION = /^(?:[\s\u200D\uFE0F]|\p{Extended_Pictographic})+/u;

/**
 * The conventional-commit type of a subject line, or `null`.
 *
 * Matches `type: …` and `type(scope): …`, case-insensitively, and only when a
 * colon actually follows — without that, a message beginning "fix the build"
 * would be filed as a `fix` alongside properly-prefixed ones and quietly
 * overstate how disciplined the period's commits were.
 */
export function conventionalType(subject: string): string | null {
  const match = /^([a-zA-Z]+)(?:\([^)]*\))?!?:/.exec(subject.replace(LEADING_DECORATION, ""));
  const type = match?.[1].toLowerCase();
  return type && CONVENTIONAL_TYPES.has(type) ? type : null;
}

/**
 * Average/shortest/longest/most-unusual commit subject, the conventional-type
 * breakdown, and the period's most-used emoji.
 *
 * Returns an all-empty shape when the period contains no commits — the caller
 * decides whether that is worth storing; a period can legitimately be all
 * reviews and issues.
 */
export function computeContentStats(rows: GithubStatsRow[]): ContentStats {
  const subjects = rows
    .filter((row) => row.eventType === "commit")
    .map((row) => row.title.trim())
    .filter((title) => title.length > 0);

  if (subjects.length === 0) {
    return {
      avgCommitMessageLength: 0,
      conventionalCommitBreakdown: [],
      shortestCommitMessage: null,
      longestCommitMessage: null,
      mostUnusualCommitMessage: null,
      mostUsedEmoji: null,
    };
  }

  const keywordCounts = new Map<string, number>();
  const emojiCounts = new Map<string, number>();
  let totalLength = 0;
  let shortest = subjects[0];
  let longest = subjects[0];

  for (const subject of subjects) {
    totalLength += subject.length;
    if (subject.length < shortest.length) shortest = subject;
    if (subject.length > longest.length) longest = subject;

    const type = conventionalType(subject);
    if (type) keywordCounts.set(type, (keywordCounts.get(type) ?? 0) + 1);

    for (const [emoji] of subject.matchAll(EMOJI_PATTERN)) {
      emojiCounts.set(emoji, (emojiCounts.get(emoji) ?? 0) + 1);
    }
  }

  const topEmoji = topEntry(emojiCounts);

  return {
    avgCommitMessageLength: Math.round((totalLength / subjects.length) * 10) / 10,
    conventionalCommitBreakdown: sortedCounts(keywordCounts),
    shortestCommitMessage: shortest,
    longestCommitMessage: longest,
    mostUnusualCommitMessage: mostUnusualSubject(subjects),
    mostUsedEmoji: topEmoji ? { emoji: topEmoji[0], count: topEmoji[1] } : null,
  };
}

function sortedCounts(counts: Map<string, number>): KeywordCount[] {
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
}

/**
 * The subject whose vocabulary is rarest across the period's own commits.
 *
 * "Unusual" is defined relative to the period rather than to English at large:
 * this codebase has no corpus to compare against, but it does have the
 * correspondent's other commits, and the message that shares the fewest words
 * with them is exactly the one that reads as out of character. Each subject is
 * scored by the mean corpus frequency of its distinct words (lower is rarer);
 * ties break on the longer message, which carries more of the oddity.
 */
function mostUnusualSubject(subjects: string[]): string {
  const documentFrequency = new Map<string, number>();
  const perSubjectWords = subjects.map((subject) => {
    const words = new Set(subject.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    for (const word of words) {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    }
    return words;
  });

  let best = subjects[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [index, words] of perSubjectWords.entries()) {
    if (words.size === 0) continue;
    let score = 0;
    for (const word of words) score += documentFrequency.get(word) ?? 1;
    score /= words.size;

    const subject = subjects[index];
    if (score < bestScore || (score === bestScore && subject.length > best.length)) {
      bestScore = score;
      best = subject;
    }
  }

  return best;
}
