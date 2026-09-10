/**
 * Generic ranking builder — Phase C, ranking type #3.
 *
 * An admin-configurable "rank top N of `<field>` from `<source>`" building
 * block: the admin picks a rankable field (drawn from a small fixed list —
 * see {@link RANKABLE_FIELDS} — rather than an infinitely dynamic schema
 * introspection, which would be unreviewable and could expose fields never
 * meant to be admin-facing), a top-N count, and an edition/period to scope
 * the underlying rows to. The raw ranking is computed with a Prisma
 * `groupBy`; one LLM call then narrates it in the newspaper voice.
 *
 * Deliberately **admin-triggered only** (never auto-wired into the pipeline)
 * — it is inherently a manual/configurable action with no sensible default
 * field/topN/scope to run unattended.
 */

import type { Article } from "@/generated/prisma/client";
import { periodLabel } from "@/lib/edition-helpers";
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

export type RankableModel = "serviceActivity" | "article";

export interface RankableField {
  model: RankableModel;
  field: string;
  label: string;
}

/**
 * The fixed set of fields the generic builder can rank by. Adding a new
 * ranking idea from an existing `ServiceActivity`/`Article` column is a
 * one-line addition here plus one `case` in {@link rankServiceActivityField}
 * / {@link rankArticleField} below — no new admin UI or route needed.
 */
export const RANKABLE_FIELDS: RankableField[] = [
  { model: "serviceActivity", field: "source", label: "Activity Source (GitHub / Blog / Spotify)" },
  { model: "serviceActivity", field: "eventType", label: "Activity Event Type (commit, pr, star, …)" },
  { model: "serviceActivity", field: "repo", label: "Repository" },
  { model: "article", field: "category", label: "Article Category" },
  { model: "article", field: "author", label: "Article Author" },
];

export function findRankableField(model: string, field: string): RankableField | undefined {
  return RANKABLE_FIELDS.find((f) => f.model === model && f.field === field);
}

export interface GenericRankingRow {
  value: string;
  count: number;
}

function toRankingRows(rows: GenericRankingRow[], topN: number): GenericRankingRow[] {
  return rows.sort((a, b) => b.count - a.count).slice(0, topN);
}

async function rankServiceActivityField(
  field: "source" | "eventType" | "repo",
  editionId: number,
  topN: number,
): Promise<GenericRankingRow[]> {
  switch (field) {
    case "source": {
      const groups = await prisma.serviceActivity.groupBy({
        by: ["source"],
        where: { editionId },
        _count: { _all: true },
      });
      return toRankingRows(groups.map((g) => ({ value: g.source, count: g._count._all })), topN);
    }
    case "eventType": {
      const groups = await prisma.serviceActivity.groupBy({
        by: ["eventType"],
        where: { editionId },
        _count: { _all: true },
      });
      return toRankingRows(groups.map((g) => ({ value: g.eventType, count: g._count._all })), topN);
    }
    case "repo": {
      const groups = await prisma.serviceActivity.groupBy({
        by: ["repo"],
        where: { editionId },
        _count: { _all: true },
      });
      return toRankingRows(
        groups.map((g) => ({ value: g.repo ?? "(none)", count: g._count._all })),
        topN,
      );
    }
  }
}

async function rankArticleField(
  field: "category" | "author",
  editionId: number,
  topN: number,
): Promise<GenericRankingRow[]> {
  switch (field) {
    case "category": {
      const groups = await prisma.article.groupBy({
        by: ["category"],
        where: { editionId },
        _count: { _all: true },
      });
      return toRankingRows(groups.map((g) => ({ value: g.category, count: g._count._all })), topN);
    }
    case "author": {
      const groups = await prisma.article.groupBy({
        by: ["author"],
        where: { editionId },
        _count: { _all: true },
      });
      return toRankingRows(
        groups.map((g) => ({ value: g.author ?? "(none)", count: g._count._all })),
        topN,
      );
    }
  }
}

/** Run the raw `groupBy` ranking for `field`, scoped to `scopeEditionId`'s rows. */
export async function computeGenericRanking(options: {
  model: RankableModel;
  field: string;
  scopeEditionId: number;
  topN: number;
}): Promise<GenericRankingRow[]> {
  if (options.model === "serviceActivity") {
    return rankServiceActivityField(
      options.field as "source" | "eventType" | "repo",
      options.scopeEditionId,
      options.topN,
    );
  }
  return rankArticleField(options.field as "category" | "author", options.scopeEditionId, options.topN);
}

function buildGenericRankingPrompt(input: {
  periodLabel: string;
  scopeLabel: string;
  fieldLabel: string;
  rows: GenericRankingRow[];
  topN: number;
}): string {
  const list = input.rows.map((r, i) => `${i + 1}. ${r.value} — ${r.count}`).join("\n");
  return (
    `Write a newspaper article for the 'Rankings' section of the ${input.periodLabel} ` +
    `edition of ¡Albricias!: a "Top ${input.topN}" countdown ranking ${input.fieldLabel} ` +
    `for ${input.scopeLabel}, presented as a vintage newspaper league table.\n\n` +
    `Present the countdown with the paper's characteristic flair, naming each entry and ` +
    `its count. Do not invent entries or counts beyond what is given below.\n\n` +
    `Ranking data (value — count):\n${list}\n\n` +
    `Give the article a compelling headline (as a markdown H1), then the body text. Do ` +
    `not include a byline or date — those are added separately.`
  );
}

export interface GenericRankingNarrationInput {
  periodLabel: string;
  scopeLabel: string;
  fieldLabel: string;
  rows: GenericRankingRow[];
  topN: number;
}

/** One LLM call narrating an already-computed generic ranking. */
export async function narrateGenericRanking(
  input: GenericRankingNarrationInput,
  aiModel?: ResolvedAiModel,
): Promise<GeneratorResult> {
  const prompt = buildGenericRankingPrompt(input);
  const raw = await runNewspaperAgent(chronicleAgent, { user: prompt, aiModel });
  const { title, content } = parseResponse(
    raw,
    `Top ${input.topN}: ${input.fieldLabel} — ${input.periodLabel}`,
  );
  return {
    title,
    content,
    category: RANKING_CATEGORY,
    sourceData: {
      generator: "generic-ranking",
      prompt,
      response: raw,
      model: MODEL_NAME,
      field: input.fieldLabel,
      rows: input.rows,
    },
  };
}

export interface GenericRankingOptions {
  /** Edition the resulting article is created inside. */
  editionId: number;
  /** Edition whose `ServiceActivity`/`Article` rows are ranked. */
  scopeEditionId: number;
  model: RankableModel;
  field: string;
  topN: number;
  aiModel?: ResolvedAiModel;
}

/**
 * Compute and narrate a generic ranking, persisting it as an `Article` inside
 * `editionId`. Throws (rather than skipping) on an invalid field or on
 * finding no rows to rank — this is an explicit, manual admin action, not a
 * step in the automatic pipeline, so a clear error for the admin to see and
 * correct is more appropriate than a silent no-op.
 */
export async function createGenericRankingArticle(options: GenericRankingOptions): Promise<Article> {
  const fieldDef = findRankableField(options.model, options.field);
  if (!fieldDef) {
    throw new Error(`Unrankable field: ${options.model}.${options.field}`);
  }
  if (!Number.isInteger(options.topN) || options.topN < 1) {
    throw new Error("Top N must be a positive integer.");
  }

  const edition = await prisma.edition.findUnique({ where: { id: options.editionId } });
  if (!edition) throw new Error(`Edition ${options.editionId} not found.`);
  const scopeEdition =
    options.scopeEditionId === options.editionId
      ? edition
      : await prisma.edition.findUnique({ where: { id: options.scopeEditionId } });
  if (!scopeEdition) throw new Error(`Edition ${options.scopeEditionId} not found.`);

  const rows = await computeGenericRanking({
    model: options.model,
    field: options.field,
    scopeEditionId: options.scopeEditionId,
    topN: options.topN,
  });
  if (rows.length === 0) {
    throw new Error(`No ${fieldDef.label} data found for ${periodLabel(scopeEdition)}.`);
  }

  const result = await narrateGenericRanking(
    {
      periodLabel: periodLabel(edition),
      scopeLabel: periodLabel(scopeEdition),
      fieldLabel: fieldDef.label,
      rows,
      topN: options.topN,
    },
    options.aiModel,
  );
  return persistRankingArticle(options.editionId, result, edition.periodStart);
}
