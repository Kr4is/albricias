/**
 * "Best of" past-content digest — Phase C, ranking type #2.
 *
 * Queries the single most recent *published* edition strictly before the one
 * being generated (reusing `@/lib/editions`'s `previousPublishedEdition` /
 * `editionArticles`, the same read-only helpers the public site uses) and
 * asks one LLM call to pick and frame a "best of last period" retrospective
 * in the newspaper voice.
 *
 * **v1 has no real engagement metrics** (opens/clicks) — per the plan, this
 * is explicitly an AI-curated editorial judgment call, not a
 * metrics-based ranking. The prompt below tells the model exactly that: pick
 * favourites and say why, but never claim or imply a real measurement
 * (view counts, popularity, etc.) that doesn't exist yet.
 *
 * Deliberately **admin-triggered only** — not wired into the automatic
 * pipeline (see the "Deviations" note in the Phase C wave notepad): a
 * "best of" digest needs a prior *published* edition to exist, which the very
 * first automatically-generated edition never has, and after that the
 * decision of "did the admin actually publish last period's edition yet" is
 * exactly the kind of judgment call the automatic pipeline shouldn't be
 * making silently.
 */

import type { Article } from "@/generated/prisma/client";
import { periodLabel } from "@/lib/edition-helpers";
import { previousPublishedEdition, editionArticles } from "@/lib/editions";
import { prisma } from "@/lib/prisma";
import {
  chronicleAgent,
  MODEL_NAME,
  parseResponse,
  runNewspaperAgent,
  type ResolvedAiModel,
} from "@/mastra/agents";
import type { GeneratorResult } from "@/mastra/schemas";
import { RANKING_CATEGORY, persistRankingArticle } from "./shared";

/** Article summary handed to the LLM prompt. */
interface BestOfCandidate {
  id: number;
  title: string;
  category: string;
  excerpt: string;
}

/** Flatten markdown whitespace and cap length for a prompt-friendly excerpt. */
function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

function buildBestOfPrompt(periodLbl: string, priorLbl: string, candidates: BestOfCandidate[]): string {
  const list = candidates
    .map((a, i) => `${i + 1}. [${a.category}] "${a.title}" — ${a.excerpt}`)
    .join("\n");
  return (
    `Write a newspaper article for the 'Rankings' section of the ${periodLbl} edition ` +
    `of ¡Albricias!: a "Best of ${priorLbl}" retrospective, curated by the editorial desk.\n\n` +
    `Below are all the articles published in the ${priorLbl} edition. Choose the handful ` +
    `(three to five) you judge most memorable, and frame the piece as a personal, ` +
    `opinionated editorial pick — explicitly your own judgment, not a measurement. Do not ` +
    `claim or imply any readership numbers, click counts, or other engagement metrics — ` +
    `none exist yet. For each pick, briefly say why it earned the nod, and note its section.\n\n` +
    `Articles from ${priorLbl}:\n${list}\n\n` +
    `Give the piece a compelling headline (as a markdown H1), then the body text. Do not ` +
    `include a byline or date — those are added separately.`
  );
}

export interface BestOfInput {
  periodLabel: string;
  priorLabel: string;
  priorEditionId: number;
  candidates: BestOfCandidate[];
}

/** One LLM call asking for an editorial "best of" pick — never a metrics-based ranking. */
export async function narrateBestOf(
  input: BestOfInput,
  aiModel?: ResolvedAiModel,
): Promise<GeneratorResult> {
  const prompt = buildBestOfPrompt(input.periodLabel, input.priorLabel, input.candidates);
  const raw = await runNewspaperAgent(chronicleAgent, { user: prompt, aiModel });
  const { title, content } = parseResponse(raw, `Best of ${input.priorLabel}`);
  return {
    title,
    content,
    category: RANKING_CATEGORY,
    sourceData: {
      generator: "best-of-digest",
      prompt,
      response: raw,
      model: MODEL_NAME,
      priorEditionId: input.priorEditionId,
      candidateArticleIds: input.candidates.map((c) => c.id),
    },
  };
}

/**
 * Build and persist a "best of last period" digest article inside
 * `editionId`, drawing its candidates from the most recent published edition
 * before it. Returns `null` — not an error — when no prior published edition
 * exists, or that edition has no articles to choose from.
 */
export async function createBestOfDigestArticle(
  editionId: number,
  aiModel?: ResolvedAiModel,
): Promise<Article | null> {
  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  if (!edition) throw new Error(`Edition ${editionId} not found.`);

  const prior = await previousPublishedEdition(edition.periodStart);
  if (!prior) return null;

  const priorArticles = await editionArticles(prior.id);
  if (priorArticles.length === 0) return null;

  const candidates: BestOfCandidate[] = priorArticles.map((a) => ({
    id: a.id,
    title: a.title,
    category: a.category,
    excerpt: excerpt(a.content),
  }));

  const result = await narrateBestOf(
    {
      periodLabel: periodLabel(edition),
      priorLabel: periodLabel(prior),
      priorEditionId: prior.id,
      candidates,
    },
    aiModel,
  );
  return persistRankingArticle(editionId, result, edition.periodStart);
}
