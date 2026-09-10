/**
 * AI-assisted article generation orchestrator — the Prisma-touching half of the
 * pipeline, mirroring the split in `app/services/ai_writer.py`:
 *
 *   - {@link generateEditionDraft}     ← `ai_writer.py:187-249`
 *   - {@link generateArticleFromSource} ← `ai_writer.py:24-179`
 *   - {@link regenerateArticle}         ← `ai_writer.py:252-285`
 *   - {@link runEditionGeneration}      ← the full "Generate edition" pipeline
 *     (fetch GitHub+blog+Spotify+Alexandria activity for a period, create the
 *     `Edition`, call {@link generateEditionDraft}), extracted from
 *     `web/src/app/admin/editions/generate/route.ts` (Phase A / scheduler) so
 *     both the manual "Generate edition" button and the cron scheduler
 *     (`web/src/lib/scheduler.ts`) call one implementation.
 *
 * The pure LLM work lives in `src/mastra/` (agents + workflows); everything
 * here is source processing, workflow invocation and `Article` persistence.
 *
 * Every text-generation function takes an optional `aiModel` (a resolved
 * `@/lib/ai/provider` result — OpenAI, Gemini, or a local Ollama server);
 * when omitted the Mastra model router falls back to the static default,
 * which is how the Flask admin routes sourced it too. Audio transcription
 * (Whisper) is a separate, OpenAI-only concern — see `audioApiKey` below and
 * `requireOpenAiKeyForAudio`.
 */

import type { Article, Edition } from "@/generated/prisma/client";
import { defaultEditionTitle, defaultEditionVol } from "@/lib/cadence";
import { getSetting } from "@/lib/config/settings";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { EDITION_STATUS_DRAFT, type Cadence, periodLabel } from "@/lib/edition-helpers";
import { describeError, type FlashMessage } from "@/lib/flash";
import { prisma } from "@/lib/prisma";
import { getServiceToken, isServiceTokenExpired, upsertServiceToken } from "@/lib/service-token";
import {
  type ActivityItem,
  type AudioMode,
  type SourceResult,
  type SourceType,
  fetchAlexandriaActivity,
  fetchBlogActivity,
  fetchCalendarEventSource,
  fetchGithubActivity,
  fetchSpotifyActivity,
  getValidGoogleAccessToken,
  processAudio,
  processText,
  refreshAccessToken,
} from "@/lib/sources";
import { chronicleAgent, parseResponse, runNewspaperAgent, type ResolvedAiModel } from "@/mastra/agents";
import { createActivityRankingArticle, createCalendarRankingArticle } from "@/lib/rankings";
import {
  type GeneratorResult,
  type GeneratorType,
  type ReviewSubjectType,
} from "@/mastra/schemas";
import {
  assistedGenerationWorkflow,
  chronicleWorkflow,
  groupActivities,
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
// `Edition.generationProgress` — live-progress JSON consumed by the SSE
// endpoint (`web/src/app/admin/editions/[editionId]/live/route.ts`). State
// lives in the DB (Principle 3 of the live-generation-ux plan), never in
// process memory — every update here is a read-modify-write of the column.
// ---------------------------------------------------------------------------

type SourceProgressStatus = "pending" | "fetching" | "done" | "skipped";

interface SourceProgress {
  github: SourceProgressStatus;
  blog: SourceProgressStatus;
  spotify: SourceProgressStatus;
  alexandria: SourceProgressStatus;
}

type SectionStatus = "pending" | "writing" | "done" | "failed" | "aborted";

interface SectionProgress {
  category: string;
  status: SectionStatus;
}

export interface GenerationProgress {
  sourceProgress: SourceProgress;
  totalSections: number;
  completedSections: number;
  sections: SectionProgress[];
}

function initialGenerationProgress(): GenerationProgress {
  return {
    sourceProgress: { github: "pending", blog: "pending", spotify: "pending", alexandria: "pending" },
    totalSections: 0,
    completedSections: 0,
    sections: [],
  };
}

function parseGenerationProgress(raw: string | null): GenerationProgress | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GenerationProgress;
  } catch {
    return null;
  }
}

/**
 * Read-modify-write `Edition.generationProgress`. Always re-reads the column
 * first (rather than threading state through function arguments) so the DB
 * stays the single source of truth every step writes through, regardless of
 * which part of the pipeline (source fetch vs. chronicle workflow) is
 * currently updating it.
 */
async function updateGenerationProgress(
  editionId: number,
  mutate: (progress: GenerationProgress) => GenerationProgress,
): Promise<GenerationProgress> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { generationProgress: true },
  });
  const current = parseGenerationProgress(edition?.generationProgress ?? null) ?? initialGenerationProgress();
  const next = mutate(current);
  await prisma.edition.update({
    where: { id: editionId },
    data: { generationProgress: JSON.stringify(next) },
  });
  return next;
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
  /** Resolved AI text-generation provider/model — see `@/lib/ai/provider`. */
  aiModel?: ResolvedAiModel;
  /**
   * OpenAI API key for Whisper audio transcription. Only used (and only
   * required) when `sourceType` starts with `"audio_"` — independent of
   * `aiModel`, since transcription stays OpenAI-only regardless of the
   * configured text-generation provider.
   */
  audioApiKey?: string;
  /** Audio bytes — required when `sourceType` starts with `"audio"`. */
  audioFile?: File | Blob | Buffer | Uint8Array | ArrayBuffer;
  /** Original filename of the audio upload; Whisper needs the extension. */
  audioFilename?: string;
  /** Pasted text — used when `sourceType` is `"text"` or `"notes"`. */
  textInput?: string;
  /** Google Calendar ID — required when `sourceType` is `"calendar_event"`. */
  calendarId?: string;
  /** Google Calendar event ID — required when `sourceType` is `"calendar_event"`. */
  googleEventId?: string;
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
  aiModel,
  audioApiKey,
  audioFile,
  audioFilename = "",
  textInput = "",
  calendarId,
  googleEventId,
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
      apiKey: audioApiKey ?? (await requireOpenAiKeyForAudio()),
    });
  } else if (sourceType === "text" || sourceType === "notes") {
    sourceResult = processText(textInput, sourceType);
  } else if (sourceType === "calendar_event") {
    if (!calendarId || !googleEventId) {
      throw new Error(`calendarId and googleEventId are required for sourceType "calendar_event".`);
    }
    const accessToken = await getValidGoogleAccessToken();
    if (!accessToken) {
      throw new Error("Google Calendar is not connected.");
    }
    sourceResult = await fetchCalendarEventSource({ accessToken, calendarId, eventId: googleEventId });
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
      aiModel,
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
  aiModel?: ResolvedAiModel,
  messages: FlashMessage[] = [],
): Promise<Article[]> {
  const activities = await prisma.serviceActivity.findMany({
    where: { editionId },
  });
  if (activities.length === 0) return [];

  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  const label = edition ? periodLabel(edition) : "this month";

  const activityInputs = activities.map((row) => ({
    eventType: row.eventType,
    repo: row.repo,
    title: row.title,
    url: row.url,
    timestamp: row.timestamp,
  }));

  // Seed generationProgress.sections/totalSections up front, before the
  // workflow starts — `workflow-step-progress` only fires when an iteration
  // *finishes*, never when one starts, so the ordered non-empty category
  // list from `groupActivities` (matching the foreach's own iteration order,
  // `concurrency: 1`) is the only way to know section 1 is "writing" from
  // the very first moment.
  const categories = [...groupActivities(activityInputs).keys()];
  await updateGenerationProgress(editionId, (progress) => ({
    ...progress,
    totalSections: categories.length,
    completedSections: 0,
    sections: categories.map((category, index) => ({
      category,
      status: index === 0 ? "writing" : "pending",
    })),
  }));

  const date = edition?.periodStart ?? new Date();
  const created: Article[] = [];

  const run = await chronicleWorkflow.createRun();
  const stream = run.stream({
    inputData: {
      activities: activityInputs,
      periodLabel: label,
      aiModel,
    },
  });

  for await (const chunk of stream.fullStream) {
    if (chunk.type !== "workflow-step-progress" || chunk.payload.id !== "write-category-article") {
      continue;
    }
    const { currentIndex, iterationStatus, iterationOutput } = chunk.payload;

    if (iterationStatus === "success") {
      // A completed iteration — either a real result, or `{ ok: false }`
      // when the step caught its own LLM-call error internally
      // (`chronicle.ts`'s `writeCategoryArticleStep`). Either way the
      // foreach queue keeps going; only persist + mark "done" on success.
      const iterationResult = iterationOutput as
        | { ok: boolean; result: GeneratorResult | null }
        | undefined;
      if (iterationResult?.ok && iterationResult.result) {
        const result = iterationResult.result;
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
      await updateGenerationProgress(editionId, (progress) => {
        const sections = [...progress.sections];
        if (sections[currentIndex]) {
          sections[currentIndex] = {
            ...sections[currentIndex],
            status: iterationResult?.ok ? "done" : "failed",
          };
        }
        if (sections[currentIndex + 1]) {
          sections[currentIndex + 1] = { ...sections[currentIndex + 1], status: "writing" };
        }
        return { ...progress, sections, completedSections: progress.completedSections + 1 };
      });
    } else {
      // `"failed"` or `"suspended"` — Mastra's foreach `killQueue()`s the
      // whole loop here (verified against `@mastra/core`'s
      // `agent-DsRUDsS_.js`); no further `workflow-step-progress` events
      // will ever arrive for this run. Mark this section and every section
      // after it "aborted" immediately, keep whatever was already
      // persisted (no rollback — product decision), and warn.
      const progress = await updateGenerationProgress(editionId, (p) => ({
        ...p,
        sections: p.sections.map((section, index) =>
          index >= currentIndex ? { ...section, status: "aborted" as const } : section,
        ),
      }));
      const category = progress.sections[currentIndex]?.category ?? `section ${currentIndex + 1}`;
      messages.push({
        type: "warning",
        text:
          `Chronicle generation stopped early while writing "${category}" (${iterationStatus}) — ` +
          `remaining sections were not written. Articles already generated were kept.`,
      });
      break;
    }
  }

  const outcome = await stream.result;
  if (outcome.status !== "success") {
    throw new Error(
      `Chronicle workflow failed (${outcome.status})`,
      outcome.status === "failed" ? { cause: outcome.error } : undefined,
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
  aiModel?: ResolvedAiModel,
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
    aiModel,
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

/** OpenAI-only, for Whisper transcription — see the `audioApiKey` doc comment above. */
async function requireOpenAiKeyForAudio(): Promise<string> {
  const key = await getSetting("integrations.openai.apiKey", { encrypted: true });
  if (!key) throw new Error("OpenAI API key is not configured. Set it at /admin/settings.");
  return key;
}

// ---------------------------------------------------------------------------
// Full edition-generation pipeline — shared by the manual "Generate edition"
// route and the cron scheduler (Phase A).
// ---------------------------------------------------------------------------

async function saveActivities(editionId: number, items: ActivityItem[]): Promise<void> {
  if (items.length === 0) return;
  await prisma.serviceActivity.createMany({
    data: items.map((item) => ({
      editionId,
      source: item.source,
      eventType: item.eventType,
      repo: item.repo,
      title: item.title,
      url: item.url,
      timestamp: item.timestamp,
      rawJson: JSON.stringify(item.raw ?? {}),
    })),
  });
}

/** An edition already existed for the requested period — nothing was generated. */
export interface EditionGenerationExists {
  status: "exists";
  edition: Edition;
}

/** A new edition was created and the pipeline ran against it. */
export interface EditionGenerationRan {
  status: "generated";
  edition: Edition;
  /** Non-fatal warnings/info collected along the way, in the order they occurred. */
  messages: FlashMessage[];
  /** Total GitHub + blog + Spotify + Alexandria activity rows saved. */
  fetchedCount: number;
  /** Of `fetchedCount`, how many came from Spotify (kept separate for the summary message). */
  spotifyFetched: number;
  /** Number of AI-generated articles created. */
  generatedCount: number;
}

export type EditionGenerationOutcome = EditionGenerationExists | EditionGenerationRan;

/**
 * Create the draft `Edition` row for `[periodStart, periodEnd)` under
 * `cadence` — the fast, synchronous half of the pipeline. If an edition
 * already exists for `(cadence, periodStart)` (the unique constraint), no
 * new row is created — the existing one is returned as-is so callers can
 * no-op instead of crashing or duplicating.
 *
 * The returned edition's `generationStatus` is `"running"`; call
 * {@link populateEditionDraft} to fetch sources, run AI generation, and flip
 * it to `"done"`. Split out of the old single `runEditionGeneration` so the
 * manual "Generate edition" route can redirect to the edition page
 * immediately (see `web/src/app/admin/editions/generate/route.ts`) instead
 * of blocking on the whole — potentially multi-minute, with a local AI
 * provider — pipeline before the admin sees anything.
 */
export async function createDraftEdition(
  cadence: Cadence,
  periodStart: Date,
  periodEnd: Date,
): Promise<EditionGenerationExists | { status: "started"; edition: Edition }> {
  const existing = await prisma.edition.findUnique({
    where: { cadence_periodStart: { cadence, periodStart } },
  });
  if (existing) {
    return { status: "exists", edition: existing };
  }

  const period = { cadence, periodStart, periodEnd };
  const edition = await prisma.edition.create({
    data: {
      cadence,
      periodStart,
      periodEnd,
      title: defaultEditionTitle(period),
      vol: defaultEditionVol(period),
      status: EDITION_STATUS_DRAFT,
      generationStatus: "running",
    },
  });
  return { status: "started", edition };
}

/**
 * Fetch every configured source and run AI generation/rankings for an
 * already-created draft `edition` — the slow half of the pipeline (see
 * {@link createDraftEdition}). Ported out of
 * `web/src/app/admin/editions/generate/route.ts`'s POST handler verbatim
 * (same per-source try/catch + non-fatal warning pattern, same final summary
 * message).
 *
 * Always marks `edition.generationStatus` as `"done"` when it returns — even
 * if something unexpected throws past the per-source try/catches below — so
 * `/admin/editions/[id]/edit`'s live view (polling while `"running"`) never
 * spins forever.
 */
export async function populateEditionDraft(
  edition: Edition,
  periodStart: Date,
  periodEnd: Date,
): Promise<EditionGenerationRan> {
  const messages: FlashMessage[] = [];
  let fetchedCount = 0;
  let spotifyFetched = 0;
  let generatedCount = 0;

  try {

  // --- GitHub fetch ---
  const [githubToken, githubUsername] = await Promise.all([
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
  ]);
  if (githubToken && githubUsername) {
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, github: "fetching" },
    }));
    try {
      const activities = await fetchGithubActivity({
        username: githubUsername,
        token: githubToken,
        periodStart,
        periodEnd,
      });
      await saveActivities(edition.id, activities);
      fetchedCount += activities.length;
    } catch (error) {
      messages.push({ type: "warning", text: `GitHub fetch warning: ${describeError(error)}` });
    } finally {
      await updateGenerationProgress(edition.id, (p) => ({
        ...p,
        sourceProgress: { ...p.sourceProgress, github: "done" },
      }));
    }
  } else {
    messages.push({
      type: "warning",
      text: "GitHub token/username not configured (/admin/settings) — skipping GitHub fetch.",
    });
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, github: "skipped" },
    }));
  }

  // --- Blog RSS fetch ---
  const blogUrl = await getSetting("integrations.blog.rssUrl");
  if (blogUrl) {
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, blog: "fetching" },
    }));
    try {
      const activities = await fetchBlogActivity({
        feedUrl: blogUrl,
        periodStart,
        periodEnd,
      });
      await saveActivities(edition.id, activities);
      fetchedCount += activities.length;
    } catch (error) {
      messages.push({ type: "warning", text: `Blog fetch warning: ${describeError(error)}` });
    } finally {
      await updateGenerationProgress(edition.id, (p) => ({
        ...p,
        sourceProgress: { ...p.sourceProgress, blog: "done" },
      }));
    }
  } else {
    messages.push({
      type: "warning",
      text: "Blog RSS URL not configured (/admin/settings) — skipping blog fetch.",
    });
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, blog: "skipped" },
    }));
  }

  // --- Spotify fetch ---
  let spotifyToken = await getServiceToken("spotify");
  if (spotifyToken) {
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, spotify: "fetching" },
    }));
    try {
      if (isServiceTokenExpired(spotifyToken) && spotifyToken.refreshToken) {
        const refreshed = await refreshAccessToken(spotifyToken.refreshToken);
        await upsertServiceToken({
          service: "spotify",
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresIn: refreshed.expires_in,
        });
        spotifyToken = await getServiceToken("spotify");
      }
      const items = await fetchSpotifyActivity({ accessToken: spotifyToken!.accessToken });
      await saveActivities(edition.id, items);
      spotifyFetched = items.length;
      fetchedCount += spotifyFetched;
    } catch (error) {
      messages.push({ type: "warning", text: `Spotify fetch warning: ${describeError(error)}` });
    } finally {
      await updateGenerationProgress(edition.id, (p) => ({
        ...p,
        sourceProgress: { ...p.sourceProgress, spotify: "done" },
      }));
    }
  } else {
    messages.push({
      type: "info",
      text: "Spotify not connected — visit /admin/spotify/connect to link your account.",
    });
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, spotify: "skipped" },
    }));
  }

  // --- Alexandria fetch (reading activity) ---
  const [alexandriaApiUrl, alexandriaApiToken] = await Promise.all([
    getSetting("integrations.alexandria.apiUrl"),
    getSetting("integrations.alexandria.apiToken", { encrypted: true }),
  ]);
  if (alexandriaApiUrl) {
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, alexandria: "fetching" },
    }));
    try {
      const activities = await fetchAlexandriaActivity({
        apiUrl: alexandriaApiUrl,
        apiToken: alexandriaApiToken,
        periodStart,
        periodEnd,
      });
      await saveActivities(edition.id, activities);
      fetchedCount += activities.length;
    } catch (error) {
      messages.push({ type: "warning", text: `Alexandria fetch warning: ${describeError(error)}` });
    } finally {
      await updateGenerationProgress(edition.id, (p) => ({
        ...p,
        sourceProgress: { ...p.sourceProgress, alexandria: "done" },
      }));
    }
  } else {
    messages.push({
      type: "info",
      text: "Alexandria API URL not configured (/admin/settings) — skipping Alexandria fetch.",
    });
    await updateGenerationProgress(edition.id, (p) => ({
      ...p,
      sourceProgress: { ...p.sourceProgress, alexandria: "skipped" },
    }));
  }

  // --- AI generation ---
  const aiModel = await resolveAiModel();
  if (aiModel && fetchedCount > 0) {
    try {
      const articles = await generateEditionDraft(edition.id, aiModel, messages);
      generatedCount = articles.length;
    } catch (error) {
      messages.push({ type: "warning", text: `AI writer warning: ${describeError(error)}` });
    }
  } else if (fetchedCount === 0) {
    messages.push({ type: "info", text: "No activity fetched from any service — AI generation skipped." });
  } else {
    messages.push({
      type: "warning",
      text: `${AI_PROVIDER_NOT_CONFIGURED_MESSAGE} — AI generation skipped.`,
    });
  }

  // --- Activity ranking (Phase C / Wave 2) ---
  // Only the activity ranking (of the three ranking kinds Phase C adds) is
  // wired into the automatic pipeline — see `web/src/lib/rankings/index.ts`'s
  // doc comment. `createActivityRankingArticle` itself returns `null` (no
  // article, not an error) when the edition has no GitHub-sourced activity to
  // rank, so this always "skips gracefully" per the plan's requirement; the
  // outer `aiModel` check just avoids the extra query entirely in the
  // no-AI-provider degraded case, same as the AI-generation gate above.
  if (aiModel) {
    try {
      const rankingArticle = await createActivityRankingArticle(edition.id, aiModel);
      if (rankingArticle) generatedCount += 1;
    } catch (error) {
      messages.push({ type: "warning", text: `Activity ranking warning: ${describeError(error)}` });
    }
  }

  // --- Calendar ranking (Phase F) ---
  // Same shape as the activity ranking above: `createCalendarRankingArticle`
  // returns `null` (no article, not an error) whenever there's nothing to
  // rank — Google Calendar not connected, no calendar in "stats"/"both" mode,
  // or zero events for the period — so this always "skips gracefully." The
  // outer `aiModel` check is the same no-extra-query optimisation as above.
  if (aiModel) {
    try {
      const calendarRankingArticle = await createCalendarRankingArticle(edition.id, aiModel);
      if (calendarRankingArticle) generatedCount += 1;
    } catch (error) {
      messages.push({ type: "warning", text: `Calendar ranking warning: ${describeError(error)}` });
    }
  }

    messages.push({
      type: "success",
      text:
        `Draft edition '${edition.title}' created with ${fetchedCount - spotifyFetched} GitHub/blog/Alexandria events, ` +
        `${spotifyFetched} Spotify items, and ${generatedCount} AI-generated articles.`,
    });
  } finally {
    await prisma.edition.update({
      where: { id: edition.id },
      data: { generationStatus: "done", generationProgress: null },
    });
  }

  return {
    status: "generated",
    edition,
    messages,
    fetchedCount,
    spotifyFetched,
    generatedCount,
  };
}

/**
 * Create the draft edition and run the full pipeline against it, fully
 * awaited — the cron scheduler's entry point (`web/src/lib/scheduler.ts`),
 * which has no page to redirect to and just wants one call that finishes
 * with the outcome. The manual "Generate edition" route uses
 * {@link createDraftEdition} + {@link populateEditionDraft} directly instead,
 * so it can redirect before the slow half runs.
 */
export async function runEditionGeneration(
  cadence: Cadence,
  periodStart: Date,
  periodEnd: Date,
): Promise<EditionGenerationOutcome> {
  const created = await createDraftEdition(cadence, periodStart, periodEnd);
  if (created.status === "exists") return created;
  return populateEditionDraft(created.edition, periodStart, periodEnd);
}
