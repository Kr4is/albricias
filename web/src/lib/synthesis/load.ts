/**
 * The synthesis module's single database read — step 5 of
 * `.omc/plans/cross-source-synthesis-compendium.md`.
 *
 * The compendium is the last thing the pipeline generates, so by the time this
 * runs every other article already exists as a row. That is why the digest is
 * built from one fresh `Article.findMany` rather than from values threaded
 * through `populateEditionDraft`: those are `const`s block-scoped inside each
 * step's own `try`, out of scope at the insertion point, and the regenerate
 * path (an admin pressing Regenerate weeks later) has no in-memory state at
 * all. A single read strictly after every prior step carries no staleness risk
 * and serves both callers identically.
 *
 * Nothing here throws on unreadable JSON: every stored column is parsed through
 * the safe readers in `@/lib/topic-candidates`, and an article whose
 * `sourceData` cannot be parsed simply falls out of every bucket — the same
 * "an optional enrichment failing costs at most itself" contract the rest of
 * the generation pipeline keeps.
 */

import { periodLabel } from "@/lib/edition-helpers";
import { prisma } from "@/lib/prisma";
import {
  isTopicCandidateMarked,
  parseStoredCuratorMarks,
  parseStoredStats,
  parseStoredTopicCandidates,
  type TopicCandidate,
} from "@/lib/topic-candidates";
import type { GithubStats } from "@/lib/github-stats";

/**
 * Which `sourceData.generator` values are machine-authored rankings.
 *
 * The first two come from the automatic pipeline; `generic-ranking` and
 * `best-of-digest` are admin-triggered from `articles/rank/page.tsx`. All four
 * are AI-written and therefore equally fair synthesis material — the exclusion
 * rule below is about *manual* articles, not about who pressed the button.
 */
const RANKING_GENERATORS = [
  "activity-ranking",
  "calendar-ranking",
  "generic-ranking",
  "best-of-digest",
];

/**
 * The compendium's own generator tag. Named here as well as in `./index.ts`
 * only to document why a prior compendium is excluded: it matches no bucket,
 * so a regenerated compendium never synthesises itself.
 */
export const SYNTHESIS_GENERATOR = "edition-synthesis";

/** The slice of an `Article` row the digest is built from. */
export interface DigestArticle {
  id: number;
  title: string;
  category: string;
  content: string;
  /** The parsed `Article.sourceData` object, or `{}` when unreadable. */
  sourceData: Record<string, unknown>;
}

/** Everything {@link buildEditionDigest} needs, and nothing it does not. */
export interface DigestInputs {
  editionId: number;
  /** `periodLabel(edition)` — resolved here so the digest layer stays pure. */
  periodLabel: string;
  /** The compendium's dateline, matching every other generated article. */
  periodStart: Date;
  /** One dispatch per activity category, from `chronicleWorkflow`. */
  chronicleArticles: DigestArticle[];
  /** Activity / calendar / generic / best-of ranking articles. */
  rankingArticles: DigestArticle[];
  /** Commissioned pieces written from a marked topic candidate. */
  topicCandidateArticles: DigestArticle[];
  /** Every bucketed article above, in one list — what the floor is counted over. */
  bucketedArticles: DigestArticle[];
  /** The edition's stored GitHub stats bank, or `null` when it has none. */
  stats: GithubStats | null;
  /** Stored topic candidates, already filtered to the ones still marked. */
  markedCandidates: TopicCandidate[];
}

/** Safe-parse an `Article.sourceData` column — a local twin of the private helper of
 * the same shape in `@/lib/generation`. Deliberately not imported from there:
 * `@/lib/generation` imports this module for the pipeline wiring, so importing
 * anything back out of it would create a module cycle — the same one-way
 * dependency `@/lib/rankings/shared.ts`'s doc comment already explains. */
function parseSourceData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Read everything the compendium synthesises for `editionId`.
 *
 * Articles are bucketed by the discriminators in the plan's Decision 1:
 * `sourceData.generator === "chronicle"`, one of {@link RANKING_GENERATORS},
 * or a string `sourceData.topicCandidateId`. Anything else is excluded — a
 * manually-authored article (no `generator` at all), because the compendium
 * accounts for what the machine wrote rather than what a person chose to write
 * themselves, and a prior compendium, because `"edition-synthesis"` matches no
 * bucket. Hidden articles are filtered in the query: an admin who unmarked a
 * topic candidate has said that piece is not part of the edition, and the
 * compendium must agree.
 *
 * Throws only when the edition itself is missing — the same contract
 * `createCalendarRankingArticle` keeps for an id that cannot exist.
 */
export async function loadDigestInputs(editionId: number): Promise<DigestInputs> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    // `periodEnd` is here because `periodLabel`'s parameter type,
    // `EditionPeriod`, requires all three fields — even though its body only
    // reads `periodStart` and `cadence`.
    select: {
      periodStart: true,
      periodEnd: true,
      cadence: true,
      githubStats: true,
      topicCandidates: true,
      curatorMarks: true,
    },
  });
  if (!edition) throw new Error(`Edition ${editionId} not found.`);

  const rows = await prisma.article.findMany({
    where: { editionId, hidden: false },
    select: { id: true, title: true, category: true, content: true, sourceData: true },
    orderBy: { order: "asc" },
  });

  const chronicleArticles: DigestArticle[] = [];
  const rankingArticles: DigestArticle[] = [];
  const topicCandidateArticles: DigestArticle[] = [];

  for (const row of rows) {
    const sourceData = parseSourceData(row.sourceData);
    const article: DigestArticle = {
      id: row.id,
      title: row.title,
      category: row.category,
      content: row.content,
      sourceData,
    };
    const generator = sourceData.generator;

    if (generator === "chronicle") {
      chronicleArticles.push(article);
    } else if (typeof generator === "string" && RANKING_GENERATORS.includes(generator)) {
      rankingArticles.push(article);
    } else if (typeof sourceData.topicCandidateId === "string") {
      topicCandidateArticles.push(article);
    }
  }

  const marks = parseStoredCuratorMarks(edition.curatorMarks);
  const markedCandidates = parseStoredTopicCandidates(edition.topicCandidates).filter((candidate) =>
    isTopicCandidateMarked(marks, candidate.id),
  );

  return {
    editionId,
    periodLabel: periodLabel(edition),
    periodStart: edition.periodStart,
    chronicleArticles,
    rankingArticles,
    topicCandidateArticles,
    bucketedArticles: [...chronicleArticles, ...rankingArticles, ...topicCandidateArticles],
    stats: parseStoredStats(edition.githubStats),
    markedCandidates,
  };
}
