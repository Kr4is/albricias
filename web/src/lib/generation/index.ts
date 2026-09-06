/**
 * AI-assisted article generation orchestrator — the Prisma-touching half of the
 * pipeline, mirroring the split in `app/services/ai_writer.py`:
 *
 *   - {@link generateEditionDraft}     ← `ai_writer.py:187-249`
 *   - {@link generateArticleFromSource} ← `ai_writer.py:24-179`
 *   - {@link regenerateArticle}         ← `ai_writer.py:252-285`
 *
 * The pure LLM work lives in `src/mastra/` (agents + workflows); everything
 * here is source processing, workflow invocation and `Article` persistence.
 *
 * Every function takes an optional `apiKey`; when omitted the Mastra model
 * router falls back to `OPENAI_API_KEY`, which is how the Flask admin routes
 * sourced it too.
 */

import type { Article } from "@/generated/prisma/client";
import { periodLabel } from "@/lib/edition-helpers";
import { prisma } from "@/lib/prisma";
import {
  type AudioMode,
  type SourceResult,
  type SourceType,
  processAudio,
  processText,
} from "@/lib/sources";
import { chronicleAgent, parseResponse, runNewspaperAgent } from "@/mastra/agents";
import {
  type GeneratorResult,
  type GeneratorType,
  type ReviewSubjectType,
} from "@/mastra/schemas";
import {
  assistedGenerationWorkflow,
  chronicleWorkflow,
} from "@/mastra/workflows";

/** By-line stamped on every AI-written piece. */
export const DEFAULT_AUTHOR = "The Albricias Correspondent";

/** `Article.sourceType` for anything the machine wrote. */
const AI_SOURCE_TYPE = "ai_generated";

/** `regenerate_article` raised the temperature above the 0.8 default. */
const REGENERATE_TEMPERATURE = 0.9;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Assisted generation pipeline — `ai_writer.py:24-179`
// ---------------------------------------------------------------------------

export interface GenerateArticleFromSourceOptions {
  /** Target edition. */
  editionId: number;
  /** `"audio_monologue"` | `"audio_conversation"` | `"text"` | `"notes"`. */
  sourceType: SourceType;
  /** `"reflection"` | `"interview"` | `"review"` | `"profile"`. */
  generatorType: GeneratorType;
  /** OpenAI API key; defaults to `OPENAI_API_KEY`. */
  apiKey?: string;
  /** Audio bytes — required when `sourceType` starts with `"audio"`. */
  audioFile?: File | Blob | Buffer | Uint8Array | ArrayBuffer;
  /** Original filename of the audio upload; Whisper needs the extension. */
  audioFilename?: string;
  /** Pasted text — used when `sourceType` is `"text"` or `"notes"`. */
  textInput?: string;
  /** Optional extra instruction passed to all generators. */
  topicHint?: string;
  /** Subject name (review / profile generators). */
  subjectName?: string;
  /** Subject category for the review generator. */
  subjectType?: ReviewSubjectType;
  /** Interviewee name (interview generator). */
  intervieweeName?: string;
  /** Dateline; defaults to the edition's period start. */
  articleDate?: Date;
  /** By-line; defaults to {@link DEFAULT_AUTHOR}. */
  author?: string;
}

/**
 * Run a source → generator pipeline and persist the resulting `Article`.
 *
 * Ported from `ai_writer.generate_article_from_source`. Throws if the source
 * type is unknown, if the audio upload is missing, or if the generation
 * workflow fails.
 */
export async function generateArticleFromSource({
  editionId,
  sourceType,
  generatorType,
  apiKey,
  audioFile,
  audioFilename = "",
  textInput = "",
  topicHint = "",
  subjectName = "",
  subjectType = "other",
  intervieweeName = "",
  articleDate,
  author = DEFAULT_AUTHOR,
}: GenerateArticleFromSourceOptions): Promise<Article> {
  // 1. Process source → normalized text.
  let sourceResult: SourceResult;
  if (sourceType === "audio_monologue" || sourceType === "audio_conversation") {
    if (!audioFile) {
      throw new Error(`audioFile is required for sourceType "${sourceType}".`);
    }
    const mode: AudioMode =
      sourceType === "audio_monologue" ? "monologue" : "conversation";
    sourceResult = await processAudio({
      data: audioFile,
      filename: audioFilename,
      mode,
      apiKey: apiKey ?? requireOpenAiKey(),
    });
  } else if (sourceType === "text" || sourceType === "notes") {
    sourceResult = processText(textInput, sourceType);
  } else {
    throw new Error(`Unknown sourceType: ${String(sourceType)}`);
  }

  // 2. Generate the article.
  const run = await assistedGenerationWorkflow.createRun();
  const outcome = await run.start({
    inputData: {
      text: sourceResult.text,
      generatorType,
      topicHint,
      subjectName,
      subjectType,
      intervieweeName,
      apiKey,
    },
  });
  if (outcome.status !== "success") {
    throw new Error(
      `Assisted generation failed (${outcome.status})`,
      outcome.status === "failed" ? { cause: outcome.error } : undefined,
    );
  }
  const result: GeneratorResult = outcome.result;

  // 3. Persist the Article.
  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  const date = articleDate ?? edition?.periodStart ?? new Date();

  return prisma.article.create({
    data: {
      editionId,
      title: result.title,
      content: result.content,
      category: result.category,
      author,
      deck: deckFor(result.content),
      order: await nextArticleOrder(editionId),
      date,
      sourceType: AI_SOURCE_TYPE,
      sourceData: JSON.stringify({
        ...result.sourceData,
        source_type: sourceType,
        source_metadata: sourceResult.metadata,
        transcription: sourceResult.text,
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Edition draft pipeline — `ai_writer.py:187-249`
// ---------------------------------------------------------------------------

/**
 * Generate AI article drafts from every `ServiceActivity` row in an edition and
 * save them as `Article`s.
 *
 * Ported from `ai_writer.generate_edition_draft`. Returns the created articles,
 * or an empty array when the edition has no activity yet. Sections whose LLM
 * call fails are skipped, matching the Python behaviour.
 */
export async function generateEditionDraft(
  editionId: number,
  apiKey?: string,
): Promise<Article[]> {
  const activities = await prisma.serviceActivity.findMany({
    where: { editionId },
  });
  if (activities.length === 0) return [];

  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  const label = edition ? periodLabel(edition) : "this month";

  const run = await chronicleWorkflow.createRun();
  const outcome = await run.start({
    inputData: {
      activities: activities.map((row) => ({
        eventType: row.eventType,
        repo: row.repo,
        title: row.title,
        url: row.url,
        timestamp: row.timestamp,
      })),
      periodLabel: label,
      apiKey,
    },
  });
  if (outcome.status !== "success") {
    throw new Error(
      `Chronicle workflow failed (${outcome.status})`,
      outcome.status === "failed" ? { cause: outcome.error } : undefined,
    );
  }

  const date = edition?.periodStart ?? new Date();
  const created: Article[] = [];
  for (const result of outcome.result) {
    created.push(
      await prisma.article.create({
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
      }),
    );
  }
  return created;
}

// ---------------------------------------------------------------------------
// Single-article regeneration — `ai_writer.py:252-285`
// ---------------------------------------------------------------------------

/**
 * Re-run AI generation for one existing article, updating title, content, deck
 * and `sourceData` in place, and return the updated row.
 *
 * Ported from `ai_writer.regenerate_article`: it replays the article's stored
 * prompt when there is one, and otherwise asks for a rewrite of the current
 * text. Throws if the article does not exist.
 */
export async function regenerateArticle(
  articleId: number,
  apiKey?: string,
): Promise<Article> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) {
    throw new Error(`Article ${articleId} not found.`);
  }

  const source = parseSourceData(article.sourceData);
  const storedPrompt =
    typeof source.prompt === "string" && source.prompt ? source.prompt : null;
  const prompt =
    storedPrompt ??
    `Rewrite and improve this vintage newspaper article titled ` +
      `'${article.title}':\n\n${article.content}`;

  // `regenerate_article` called the model with the bare NEWSPAPER_PERSONA as
  // its system prompt — which is exactly the chronicle agent's instructions.
  const raw = await runNewspaperAgent(chronicleAgent, {
    user: prompt,
    apiKey,
    temperature: REGENERATE_TEMPERATURE,
  });
  const { title, content } = parseResponse(raw, article.title);

  return prisma.article.update({
    where: { id: articleId },
    data: {
      title: title || article.title,
      content,
      deck: deckFor(content),
      sourceData: JSON.stringify({
        ...source,
        last_regeneration_response: raw,
        last_regenerated_at: new Date().toISOString(),
      }),
    },
  });
}

function requireOpenAiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  return key;
}
