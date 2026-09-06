/**
 * Shared plumbing for the ranking article generators (activity, best-of,
 * generic — Phase C of the agent-editions plan).
 *
 * Each ranking type follows the same shape: a pure-TypeScript computation
 * over already-stored rows, one Mastra LLM call in the `NEWSPAPER_PERSONA`
 * voice (via the existing `chronicleAgent` / `runNewspaperAgent`, exactly the
 * pattern `regenerateArticle` in `@/lib/generation` already uses for a
 * single, non-workflow LLM call), and persistence as an `Article` via
 * {@link persistRankingArticle} below.
 *
 * `persistRankingArticle` is a small, independent twin of `@/lib/generation`'s
 * private article-creation logic (`deckFor`, `nextArticleOrder`,
 * `AI_SOURCE_TYPE`, `DEFAULT_AUTHOR`) rather than an import from that module —
 * the same convention `@/lib/article-order.ts`'s `nextArticleOrder` already
 * established. This is not just style: `@/lib/generation/index.ts` imports
 * `createActivityRankingArticle` from this package for the Phase C pipeline
 * wiring (see `runEditionGeneration`), so importing anything back out of
 * `@/lib/generation` here would create a module cycle. Keeping this package
 * a one-way dependency of `@/lib/generation` avoids that entirely.
 */

import type { Article } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { GeneratorResult } from "@/mastra/schemas";

/** By-line stamped on every AI-written piece — mirrors `@/lib/generation`'s `DEFAULT_AUTHOR`. */
const DEFAULT_AUTHOR = "The Albricias Correspondent";

/**
 * Newspaper section every ranking generator's `GeneratorResult.category`
 * uses. Deliberately not added to `ARTICLE_CATEGORIES`
 * (`@/lib/article-categories`, the admin's manual-article dropdown) — the
 * same established pattern as chronicle's AI-only categories ("Discoveries",
 * "Culture", "Podcasts").
 */
export const RANKING_CATEGORY = "Rankings";

/** `Article.sourceType` for anything the machine wrote — mirrors `@/lib/generation`'s private `AI_SOURCE_TYPE`. */
const AI_SOURCE_TYPE = "ai_generated";

/** `Article.deck` is the piece's drop cap — the body's first character. */
function deckFor(content: string): string {
  return content.charAt(0) || "A";
}

/** Next free `order` within an edition (`max(order) + 1`, or 1 when empty). */
async function nextArticleOrder(editionId: number): Promise<number> {
  const { _max } = await prisma.article.aggregate({
    where: { editionId },
    _max: { order: true },
  });
  return (_max.order ?? 0) + 1;
}

/**
 * Persist a ranking `GeneratorResult` as an `Article`, the same shape every
 * other AI generator's output already takes (`generateEditionDraft`,
 * `generateArticleFromSource`).
 */
export async function persistRankingArticle(
  editionId: number,
  result: GeneratorResult,
  date: Date,
): Promise<Article> {
  return prisma.article.create({
    data: {
      editionId,
      title: result.title,
      content: result.content,
      category: result.category,
      author: DEFAULT_AUTHOR,
      deck: deckFor(result.content),
      order: await nextArticleOrder(editionId),
      date,
      sourceType: AI_SOURCE_TYPE,
      sourceData: JSON.stringify(result.sourceData),
    },
  });
}
