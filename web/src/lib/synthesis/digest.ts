/**
 * The digest — what the compendium is allowed to know.
 *
 * Pure, no I/O: {@link buildEditionDigest} takes what `./load.ts` read and
 * reduces it to the smallest object that still supports a grounded editorial.
 * Two things follow from that being a real object rather than a string.
 *
 * First, cost: full article bodies would be tens of thousands of tokens for a
 * busy month, so each piece contributes a title and a 160-character excerpt —
 * the same excerpt convention the newsletter already uses (`@/lib/mail.ts`) —
 * and the numbers come from the stats bank rather than from prose.
 *
 * Second, verifiability: the digest is stored verbatim in the article's own
 * `sourceData`, so every claim the model makes can afterwards be checked, by
 * hand, against the exact material it was given. A digest that is a structured
 * object makes that check bounded; a digest that was an opaque prompt string
 * would not.
 */

import type { TopicCandidate } from "@/lib/topic-candidates";
import type { DigestArticle, DigestInputs } from "./load";

/** Excerpt length, matching the newsletter's own convention (`@/lib/mail.ts`). */
const EXCERPT_LENGTH = 160;

/**
 * How many marked candidates reach the prompt. The stored list is capped at 5
 * per edition today, so 8 is headroom rather than a cut — it exists so a
 * future, longer list cannot silently inflate the prompt.
 */
const MAX_DIGEST_CANDIDATES = 8;

/** One article, reduced to what can be cited about it. */
export interface DigestItem {
  title: string;
  category: string;
  /** First {@link EXCERPT_LENGTH} characters of the body, markdown stripped. */
  excerpt: string;
}

/** One marked topic candidate — the angles a human curator left standing. */
export interface DigestCandidate {
  title: string;
  kind: string;
  score: number;
  repos: string[];
  bullets: string[];
}

/** A single quotable figure, pre-formatted so the model never has to do arithmetic. */
export interface DigestNumber {
  label: string;
  value: string;
}

/** The whole of what the compendium may cite. Stored verbatim in `sourceData.digest`. */
export interface EditionDigest {
  periodLabel: string;
  /** Per-source dispatches from the chronicle desk. */
  chronicle: DigestItem[];
  /** Activity / calendar / generic / best-of rankings. */
  rankings: DigestItem[];
  /** Commissioned pieces written from a topic candidate. */
  features: DigestItem[];
  /** Top {@link MAX_DIGEST_CANDIDATES} marked candidates, highest score first. */
  topicCandidates: DigestCandidate[];
  /** Headline figures from the GitHub stats bank and the rankings' own computations. */
  numbers: DigestNumber[];
}

/**
 * First {@link EXCERPT_LENGTH} characters of `content` with markdown syntax
 * removed — character-for-character the newsletter's rule (`mail.ts:126`), so
 * a reader comparing the two sees the same opening text.
 */
export function excerptOf(content: string): string {
  return content.replace(/[#*_`>[\]]/g, "").slice(0, EXCERPT_LENGTH).trim();
}

function toItem(article: DigestArticle): DigestItem {
  return { title: article.title, category: article.category, excerpt: excerptOf(article.content) };
}

function toCandidate(candidate: TopicCandidate): DigestCandidate {
  return {
    title: candidate.title,
    kind: candidate.kind,
    score: candidate.score,
    repos: candidate.repos,
    bullets: candidate.bullets,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A figure is only quotable if it is a real number and says something — zero counts are noise. */
function pushCount(numbers: DigestNumber[], label: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    numbers.push({ label, value: String(value) });
  }
}

function pushText(numbers: DigestNumber[], label: string, value: string | null | undefined): void {
  if (value) numbers.push({ label, value });
}

/**
 * Headline figures from the stored GitHub stats bank.
 *
 * Only fields that are both present and non-zero are emitted: the bank
 * deliberately distinguishes "computed, and the answer is zero" from "never
 * computed" (see `@/lib/github-stats`'s types), and neither is worth a
 * sentence in a compendium. Anything absent here is simply a figure the month
 * has no claim to make about.
 */
function statsNumbers(inputs: DigestInputs): DigestNumber[] {
  const numbers: DigestNumber[] = [];
  const { stats } = inputs;
  if (!stats) return numbers;

  pushCount(numbers, "Commits", stats.volume.totalCommits);
  pushCount(numbers, "Pull requests", stats.volume.totalPrs);
  pushCount(numbers, "Issues", stats.volume.totalIssues);
  pushCount(numbers, "Releases published", stats.volume.totalReleases);
  pushCount(numbers, "Distinct repositories touched", stats.volume.distinctRepos);
  if (stats.volume.mostActiveRepo) {
    numbers.push({
      label: "Most active repository",
      value: `${stats.volume.mostActiveRepo.repo} (${stats.volume.mostActiveRepo.count} events)`,
    });
  }
  if (stats.volume.newRepos.length > 0) {
    numbers.push({ label: "New repositories", value: stats.volume.newRepos.join(", ") });
  }

  if (stats.temporal.busiestDay) {
    numbers.push({
      label: "Busiest day",
      value: `${stats.temporal.busiestDay.date} (${stats.temporal.busiestDay.count} events)`,
    });
  }
  pushCount(numbers, "Longest streak (days)", stats.temporal.longestStreakDays);
  pushCount(numbers, "Longest quiet gap (days)", stats.temporal.longestGapDays);

  pushCount(numbers, "Pull requests merged", stats.collaboration.prsMerged);
  pushCount(numbers, "Reviews given", stats.collaboration.reviewsGiven);
  if (stats.collaboration.externalRepos.length > 0) {
    numbers.push({
      label: "External repositories contributed to",
      value: stats.collaboration.externalRepos.join(", "),
    });
  }

  const languages = stats.language.topLanguagesByBytes.map((l) => l.language);
  if (languages.length > 0) {
    numbers.push({ label: "Most-used languages", value: languages.join(", ") });
  }

  pushText(numbers, "Most unusual commit message", stats.content.mostUnusualCommitMessage);

  if (stats.trend?.vsPreviousPeriod) {
    const trend = stats.trend.vsPreviousPeriod;
    const percent = trend.deltaPercent === null ? "" : ` (${trend.deltaPercent}%)`;
    numbers.push({
      label: "Versus the previous period",
      value: `${trend.direction}, ${trend.deltaContributions} contributions${percent}`,
    });
  }

  return numbers;
}

/**
 * Headline figures the ranking articles already computed for themselves.
 *
 * Each ranking generator stores its own pure computation under
 * `sourceData.computation` (`@/lib/rankings/activity.ts`,
 * `@/lib/rankings/calendar.ts`). Reading those back is how a no-GitHub month
 * still has real numbers to cite — the calendar ranking's hours and event
 * counts exist whether or not a stats bank does.
 */
function rankingNumbers(inputs: DigestInputs): DigestNumber[] {
  const numbers: DigestNumber[] = [];

  for (const article of inputs.rankingArticles) {
    const computation = asRecord(article.sourceData.computation);
    if (!computation) continue;

    if (article.sourceData.generator === "calendar-ranking") {
      pushCount(numbers, "Calendar events", computation.totalEvents);
      pushCount(numbers, "Hours scheduled", computation.totalHours);
    } else if (article.sourceData.generator === "activity-ranking") {
      pushCount(numbers, "GitHub events recorded", computation.totalEvents);
    }
  }

  return numbers;
}

/**
 * Reduce a loaded edition to the compendium's entire factual universe.
 *
 * Pure by design, and that is the point of the split: the LLM call's inputs
 * are computed by a function that can be reasoned about (and re-run against
 * the stored `sourceData.digest`) without a database in the way.
 */
export function buildEditionDigest(inputs: DigestInputs): EditionDigest {
  return {
    periodLabel: inputs.periodLabel,
    chronicle: inputs.chronicleArticles.map(toItem),
    rankings: inputs.rankingArticles.map(toItem),
    features: inputs.topicCandidateArticles.map(toItem),
    topicCandidates: [...inputs.markedCandidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DIGEST_CANDIDATES)
      .map(toCandidate),
    numbers: [...statsNumbers(inputs), ...rankingNumbers(inputs)],
  };
}
