/**
 * Cross-source synthesis — the front-page "Monthly Compendium".
 *
 * Every other generator in this app writes one column about one thing: the
 * chronicle desk turns a source's activity into a dispatch, the ranking
 * generators narrate their own numbers, a commissioned piece follows a single
 * topic candidate. None of them ever sees another's output. This module is the
 * one step that reads across all of it — it runs last in `populateEditionDraft`
 * (and on demand from Regenerate), digests everything the edition already has,
 * and writes the editorial that ties the period together.
 *
 * Shape is the same as `@/lib/rankings/`: compute (here, read + digest), one
 * LLM call, persist an `Article`. Two things are deliberately different.
 *
 * 1. **The lead position is structural.** `order` comes from
 *    `leadArticleOrder`, which is always `<= -1` — strictly below every other
 *    article in the edition, so the compendium is `articles[0]` in every issue
 *    layout without a single layout change.
 * 2. **Temperature is lowered to {@link SYNTHESIS_TEMPERATURE}.** Nothing else
 *    in this codebase asks for less sampling randomness; this article does,
 *    because its entire value is factual grounding in the digest, not variety.
 *
 * `DEFAULT_AUTHOR`, `deckFor` and `AI_SOURCE_TYPE` below are local twins of the
 * private helpers of the same names in `@/lib/generation`, not imports from it.
 * That module imports this one for the pipeline wiring, so importing anything
 * back out of it would create a module cycle — the same one-way dependency
 * `@/lib/rankings/shared.ts`'s doc comment already explains.
 */

import type { Article } from "@/generated/prisma/client";
import { leadArticleOrder } from "@/lib/article-order";
import { prisma } from "@/lib/prisma";
import { parseResponse, runNewspaperAgent, synthesisAgent, type ResolvedAiModel } from "@/mastra/agents";
import { buildEditionDigest, type EditionDigest } from "./digest";
import { type DigestInputs, loadDigestInputs, SYNTHESIS_GENERATOR } from "./load";
import { buildSynthesisPrompt } from "./prompt";

/** By-line stamped on every AI-written piece — mirrors `@/lib/generation`'s `DEFAULT_AUTHOR`. */
const DEFAULT_AUTHOR = "The Albricias Correspondent";

/** `Article.sourceType` for anything the machine wrote — mirrors `@/lib/generation`'s private `AI_SOURCE_TYPE`. */
const AI_SOURCE_TYPE = "ai_generated";

/**
 * Newspaper section the compendium is filed under. Deliberately not added to
 * `ARTICLE_CATEGORIES` (the admin's manual-article dropdown), the same
 * established pattern as `RANKING_CATEGORY` and chronicle's AI-only sections.
 */
const SYNTHESIS_CATEGORY = "Compendium";

/**
 * Below `DEFAULT_TEMPERATURE` (0.8) and far below `REGENERATE_TEMPERATURE`
 * (0.9, which exists for the opposite reason — rewrite variety). No precedent
 * in this codebase for a *lower* temperature; justified on first principles.
 */
const SYNTHESIS_TEMPERATURE = 0.4;

/** Fewest bucketed articles worth synthesising at all. */
const MIN_DIGEST_ARTICLES = 3;

/**
 * Fewest distinct `Article.category` values among them.
 *
 * Counted over categories rather than over buckets on purpose: a month with
 * blog, Spotify and Alexandria activity but no GitHub produces several
 * chronicle articles and nothing else — one bucket, but "General", "Culture",
 * "Podcasts" and "Bookshelf" are distinct categories. That is a genuinely
 * multi-source month, and a bucket-count floor would have skipped it.
 */
const MIN_DIGEST_CATEGORIES = 2;

/** `Article.deck` is the piece's drop cap — the body's first character. */
function deckFor(content: string): string {
  return content.charAt(0) || "A";
}

/** Is there enough here to be worth synthesising? See the two floors above. */
function hasEnoughToSynthesise(inputs: DigestInputs): boolean {
  if (inputs.bucketedArticles.length < MIN_DIGEST_ARTICLES) return false;
  const categories = new Set(inputs.bucketedArticles.map((article) => article.category));
  return categories.size >= MIN_DIGEST_CATEGORIES;
}

interface SynthesisDraft {
  title: string;
  content: string;
  digest: EditionDigest;
  prompt: string;
  /** The raw LLM response, stored verbatim like every other generator's. */
  raw: string;
}

/** Digest, prompt, one LLM call — everything both entry points share. */
async function draftSynthesis(
  inputs: DigestInputs,
  aiModel: ResolvedAiModel | undefined,
): Promise<SynthesisDraft> {
  const digest = buildEditionDigest(inputs);
  const prompt = buildSynthesisPrompt(digest, inputs.periodLabel);
  const raw = await runNewspaperAgent(synthesisAgent, {
    user: prompt,
    aiModel,
    temperature: SYNTHESIS_TEMPERATURE,
  });
  const { title, content } = parseResponse(raw, `The Compendium — ${inputs.periodLabel}`);
  return { title, content, digest, prompt, raw };
}

function sourceDataFor(draft: SynthesisDraft): string {
  return JSON.stringify({
    generator: SYNTHESIS_GENERATOR,
    digest: draft.digest,
    prompt: draft.prompt,
    response: draft.raw,
  });
}

/**
 * Write the compendium for `editionId` and persist it as the edition's lead
 * article.
 *
 * Returns `null` — not an error — when the edition has too little to
 * synthesise (see {@link hasEnoughToSynthesise}), so the automatic pipeline
 * skips gracefully with no article and no warning, the same contract the
 * ranking generators keep. The caller is expected to have an AI provider
 * already resolved; with none configured this is never called at all.
 */
export async function createEditionSynthesisArticle(
  editionId: number,
  aiModel: ResolvedAiModel | undefined,
): Promise<Article | null> {
  const inputs = await loadDigestInputs(editionId);
  if (!hasEnoughToSynthesise(inputs)) return null;

  const draft = await draftSynthesis(inputs, aiModel);

  return prisma.article.create({
    data: {
      editionId,
      title: draft.title,
      content: draft.content,
      category: SYNTHESIS_CATEGORY,
      author: DEFAULT_AUTHOR,
      deck: deckFor(draft.content),
      // Computed immediately before the create, so it accounts for every
      // article the pipeline produced ahead of this one.
      order: await leadArticleOrder(editionId),
      date: inputs.periodStart,
      sourceType: AI_SOURCE_TYPE,
      sourceData: sourceDataFor(draft),
    },
  });
}

/**
 * Rewrite an existing compendium in place — the Regenerate path.
 *
 * Takes the already-fetched row rather than an id because its caller
 * (`regenerateArticle`) has it in hand. Only title, content, deck and
 * `sourceData` are written: `order` in particular must survive untouched, or
 * the piece would lose the lead position that is the whole point of it.
 *
 * Unlike {@link createEditionSynthesisArticle} this does not check the floor.
 * The article already exists and an admin has explicitly asked for it to be
 * rewritten; silently leaving stale text in the lead slot would be the worse
 * answer. Regenerating is also how curation reaches the compendium — unmarking
 * a topic candidate hides its article and drops it from `curatorMarks`, and
 * this rebuild is what makes the stored digest agree.
 */
export async function rebuildEditionSynthesisArticle(
  article: Article,
  aiModel?: ResolvedAiModel,
): Promise<Article> {
  const inputs = await loadDigestInputs(article.editionId);
  const draft = await draftSynthesis(inputs, aiModel);

  return prisma.article.update({
    where: { id: article.id },
    data: {
      title: draft.title,
      content: draft.content,
      deck: deckFor(draft.content),
      sourceData: sourceDataFor(draft),
    },
  });
}

export { buildEditionDigest, excerptOf } from "./digest";
export type { DigestCandidate, DigestItem, DigestNumber, EditionDigest } from "./digest";
export { loadDigestInputs, SYNTHESIS_GENERATOR } from "./load";
export type { DigestArticle, DigestInputs } from "./load";
export { buildSynthesisPrompt } from "./prompt";
