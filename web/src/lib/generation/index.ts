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
import { computeGithubStats } from "@/lib/github-stats";
import {
  computeTopicCandidates,
  type TopicCandidate,
  type TopicCandidateKind,
} from "@/lib/topic-candidates";
import {
  type ActivityItem,
  type AudioMode,
  type SourceResult,
  type SourceType,
  fetchAlexandriaActivity,
  fetchBlogActivity,
  fetchCalendarEventSource,
  fetchGithubActivity,
  fetchGithubRepoSource,
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
  CHRONICLE_CONCURRENCY,
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
  /**
   * Warnings/errors collected while the pipeline ran. The manual "Generate
   * edition" route redirects long before generation finishes, so a flash
   * message can't carry these — they live on the row instead and are rendered
   * by `/admin/editions/[editionId]/edit`. Optional: rows written before this
   * field existed parse without it.
   */
  messages?: FlashMessage[];
}

function initialGenerationProgress(): GenerationProgress {
  return {
    sourceProgress: { github: "pending", blog: "pending", spotify: "pending", alexandria: "pending" },
    totalSections: 0,
    completedSections: 0,
    sections: [],
    messages: [],
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
 * Give one finished section its final status and start the next queued one.
 *
 * The promoted section is the next one still `"pending"`, not `index + 1`:
 * with concurrent writing, iterations finish out of order, so "the section
 * after the one that just finished" is usually already in flight. Counting
 * the settled sections rather than incrementing keeps the total honest even
 * if the same iteration were ever reported twice.
 */
function settleSection(
  progress: GenerationProgress,
  index: number,
  status: SectionStatus,
): GenerationProgress {
  if (!progress.sections[index]) return progress;
  const sections: SectionProgress[] = progress.sections.map((section, i) =>
    i === index ? { ...section, status } : section,
  );
  const nextQueued = sections.findIndex((section) => section.status === "pending");
  if (nextQueued !== -1) {
    sections[nextQueued] = { ...sections[nextQueued], status: "writing" };
  }
  return {
    ...progress,
    sections,
    completedSections: sections.filter(
      (section) => section.status !== "pending" && section.status !== "writing",
    ).length,
  };
}

/**
 * Serialises {@link updateGenerationProgress}'s read-modify-write cycles.
 *
 * Now that chronicle sections are written concurrently, several iterations
 * finish within the same tick and would otherwise interleave read → mutate →
 * write and lose each other's updates. Each call chains onto the previous one
 * (the chain itself never rejects, so one failed write cannot wedge the queue)
 * while still returning its *own* result to its *own* caller. This is a lock on
 * the write cycle, not a cache: nothing is held in memory between calls, so the
 * DB column stays the single source of truth the SSE endpoint reads.
 */
let generationProgressQueue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write `Edition.generationProgress`. Always re-reads the column
 * first (rather than threading state through function arguments) so the DB
 * stays the single source of truth every step writes through, regardless of
 * which part of the pipeline (source fetch vs. chronicle workflow) is
 * currently updating it.
 */
function updateGenerationProgress(
  editionId: number,
  mutate: (progress: GenerationProgress) => GenerationProgress,
): Promise<GenerationProgress> {
  const result = generationProgressQueue.then(() =>
    applyGenerationProgress(editionId, mutate),
  );
  generationProgressQueue = result.catch(() => undefined);
  return result;
}

async function applyGenerationProgress(
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

/**
 * Append `extra` to `Edition.generationProgress.messages` — how a caller that
 * runs the pipeline in the background (`app/admin/editions/generate/route.ts`'s
 * `after()` block) reports a failure to an admin who was redirected away from
 * the POST long before it happened.
 */
export async function appendGenerationMessages(
  editionId: number,
  extra: FlashMessage[],
): Promise<void> {
  if (extra.length === 0) return;
  await updateGenerationProgress(editionId, (progress) => ({
    ...progress,
    messages: [...(progress.messages ?? []), ...extra],
  }));
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
  /** `owner/name` of the repo to write about — required when `sourceType` is `"github_repo"`. */
  githubRepo?: string;
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
  /**
   * Extra fields merged into the persisted `Article.sourceData`, on top of
   * the generator's own `result.sourceData` and the source-processing
   * metadata below — e.g. `{ topicCandidateId }` for the automatic
   * topic-candidate pipeline ({@link generateTopicCandidateArticles}).
   */
  extraSourceData?: Record<string, unknown>;
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
  githubRepo,
  topicHint = "",
  subjectName = "",
  subjectType = "other",
  intervieweeName = "",
  articleDate,
  author = DEFAULT_AUTHOR,
  extraSourceData = {},
}: GenerateArticleFromSourceOptions): Promise<Article> {
  // 1. Process source → normalized text.
  let sourceResult: SourceResult;
  /**
   * The `github_repo` branch below fills this in from the picked repo when the
   * caller left it blank — everything else just passes the caller's value
   * through.
   */
  let resolvedSubjectName = subjectName;
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
  } else if (sourceType === "github_repo") {
    if (!githubRepo) {
      throw new Error(`githubRepo is required for sourceType "github_repo".`);
    }
    const token = await getSetting("integrations.github.token", { encrypted: true });
    if (!token) {
      throw new Error("GitHub token is not configured. Set it at /admin/settings.");
    }
    sourceResult = await fetchGithubRepoSource({ token, repo: githubRepo });
    // The repo picker already told the form which repo this is, so the admin
    // should not have to retype it as the review/profile subject. `owner/` is
    // dropped: the subject of the piece is the project, not its namespace.
    if (!resolvedSubjectName.trim() && (generatorType === "review" || generatorType === "profile")) {
      resolvedSubjectName = githubRepo.split("/")[1] ?? githubRepo;
    }
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
      subjectName: resolvedSubjectName,
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
        ...extraSourceData,
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Automatic topic-candidate article generation
// (`.omc/plans/github-insights-curation-and-full-automation.md`, Step 3) —
// writes an article for the topic candidates that clear a score threshold,
// with no admin action required, unlike the manual `github_repo` assisted
// generation above that this reuses.
// ---------------------------------------------------------------------------

/**
 * Score at/above which a topic candidate gets its own auto-generated article.
 *
 * An evidence-based starting point, **not a final value** — the only real
 * scored data available in this dev environment (edition id 6) had
 * candidates at 35/27/27 out of a 100-point theoretical max, so a much higher
 * bar (e.g. 70) would never fire against typical monthly activity. Revisit
 * once more real editions have gone through scoring.
 */
export const TOPIC_CANDIDATE_AUTO_GENERATE_THRESHOLD = 35;

/**
 * `TopicCandidate.kind` → `GeneratorType` for the automatic pipeline.
 * `interview` has no entry because it isn't a `TopicCandidateKind` at all —
 * it needs a real conversation to transcribe, which no topic candidate has.
 */
const TOPIC_CANDIDATE_GENERATOR_TYPE: Record<TopicCandidateKind, GeneratorType> = {
  release: "review",
  bugfixStory: "reflection",
  newLanguage: "tutorial",
  concentration: "profile",
  streak: "profile",
  fastPrVelocity: "profile",
  externalContribution: "profile",
  curiosity: "reflection",
};

/** Read + validate a stored `Edition.topicCandidates` column, defaulting to none. */
function parseStoredTopicCandidates(stored: string | null | undefined): TopicCandidate[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as TopicCandidate[]) : [];
  } catch {
    return [];
  }
}

/**
 * Auto-generate one `Article` per topic candidate stored on the edition whose
 * `score` is at least {@link TOPIC_CANDIDATE_AUTO_GENERATE_THRESHOLD}.
 *
 * Reuses the exact same `github_repo` source path as manual assisted
 * generation ({@link generateArticleFromSource}'s `"github_repo"` branch),
 * just called programmatically with `candidate.repos[0]` and the
 * `TOPIC_CANDIDATE_GENERATOR_TYPE`-mapped generator instead of a form
 * submission. Each created article's `sourceData.topicCandidateId` is set to
 * the candidate's `id` — the key the curation UI (Step 4) uses to find and
 * hide/show the article a candidate produced.
 *
 * Re-reads `topicCandidates` from the DB (rather than trusting an in-memory
 * `Edition`) since it's written by `computeTopicCandidates()` earlier in the
 * same `populateEditionDraft` run than the caller's copy was loaded.
 *
 * Each candidate is generated in its own try/catch — a bad repo or an
 * unreadable README pushes a warning onto `messages` and does not stop the
 * others, the same non-fatal-per-item pattern used everywhere else in this
 * file (e.g. the chronicle workflow's per-section handling above).
 */
export async function generateTopicCandidateArticles(
  editionId: number,
  aiModel: ResolvedAiModel | undefined,
  messages: FlashMessage[],
): Promise<Article[]> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { topicCandidates: true },
  });
  const candidates = parseStoredTopicCandidates(edition?.topicCandidates);
  const qualifying = candidates.filter(
    (candidate) => candidate.score >= TOPIC_CANDIDATE_AUTO_GENERATE_THRESHOLD,
  );

  const created: Article[] = [];
  for (const candidate of qualifying) {
    try {
      const repo = candidate.repos[0];
      if (!repo) {
        throw new Error(
          `Topic candidate "${candidate.title}" (${candidate.kind}) has no repo to write about.`,
        );
      }
      const article = await generateArticleFromSource({
        editionId,
        sourceType: "github_repo",
        generatorType: TOPIC_CANDIDATE_GENERATOR_TYPE[candidate.kind],
        githubRepo: repo,
        aiModel,
        extraSourceData: { topicCandidateId: candidate.id },
      });
      created.push(article);
    } catch (error) {
      messages.push({
        type: "warning",
        text: `Topic candidate article generation warning ("${candidate.title}"): ${describeError(error)}`,
      });
    }
  }
  return created;
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
 *
 * The chronicle workflow writes `CHRONICLE_CONCURRENCY` sections at a time, so
 * iterations finish out of order and each one settles on its own: a failure
 * neither stops the loop nor changes any sibling section's status.
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
  // list from `groupActivities` (the foreach's own iteration order) is the
  // only way to know which sections are already "writing" from the very
  // first moment. The foreach starts `CHRONICLE_CONCURRENCY` of them at
  // once, so that many are seeded as "writing", not just the first.
  const categories = [...groupActivities(activityInputs).keys()];
  await updateGenerationProgress(editionId, (progress) => ({
    ...progress,
    totalSections: categories.length,
    completedSections: 0,
    sections: categories.map((category, index) => ({
      category,
      status: index < CHRONICLE_CONCURRENCY ? "writing" : "pending",
    })),
  }));

  const date = edition?.periodStart ?? new Date();
  const created: Article[] = [];

  // One `max(order) + 1` read for the whole run: concurrent iterations
  // asking for it one article at a time would all see the same value and
  // write duplicate `Article.order`s. The workflow hands each section
  // `baseOrder + n` instead.
  const baseOrder = await nextArticleOrder(editionId);

  const run = await chronicleWorkflow.createRun();
  const stream = run.stream({
    inputData: {
      activities: activityInputs,
      periodLabel: label,
      baseOrder,
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
      // when the step caught its own error internally (`chronicle.ts`'s
      // `writeCategoryArticleStep` catches every one of them). Either way
      // the foreach queue keeps going; only persist + mark "done" on
      // success. With `CHRONICLE_CONCURRENCY > 1` these arrive out of
      // order, so `currentIndex` is the only trustworthy identifier.
      const iterationResult = iterationOutput as
        | { ok: boolean; result: GeneratorResult | null; order: number }
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
              order: iterationResult.order,
              date,
              sourceType: AI_SOURCE_TYPE,
              sourceData: JSON.stringify(result.sourceData),
            },
          }),
        );
      }
      await updateGenerationProgress(editionId, (progress) =>
        settleSection(progress, currentIndex, iterationResult?.ok ? "done" : "failed"),
      );
    } else {
      // `"failed"` or `"suspended"` — a Mastra-level failure the step did
      // not catch itself, which is now a genuine edge case (schema
      // mismatch, abort signal). Mastra `killQueue()`s the foreach here
      // (verified against `@mastra/core`'s `agent-DsRUDsS_.js`), dropping
      // iterations that had not started yet — but iterations already in
      // flight still report normally, so the loop keeps reading instead of
      // breaking, and only *this* section is marked aborted. Whatever was
      // already persisted is kept (no rollback — product decision).
      const progress = await updateGenerationProgress(editionId, (p) =>
        settleSection(p, currentIndex, "aborted"),
      );
      const category = progress.sections[currentIndex]?.category ?? `section ${currentIndex + 1}`;
      messages.push({
        type: "warning",
        text:
          `The "${category}" section could not be written (${iterationStatus}). ` +
          `The other sections were unaffected.`,
      });
    }
  }

  // The stream is exhausted, so nothing can still be in progress: a section
  // left "pending"/"writing" was dropped by a `killQueue()` above and would
  // otherwise show a "writing…" placeholder forever.
  let dropped: string[] = [];
  await updateGenerationProgress(editionId, (progress) => {
    dropped = progress.sections
      .filter((section) => section.status === "pending" || section.status === "writing")
      .map((section) => section.category);
    return {
      ...progress,
      sections: progress.sections.map((section) =>
        dropped.includes(section.category) ? { ...section, status: "aborted" as const } : section,
      ),
    };
  });
  if (dropped.length > 0) {
    messages.push({
      type: "warning",
      text:
        `${dropped.length} section${dropped.length === 1 ? "" : "s"} were never written ` +
        `(${dropped.join(", ")}). The articles already generated were kept.`,
    });
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

  /**
   * Mirror everything collected so far onto the edition row. The route that
   * starts this pipeline in the background has already responded, so the row
   * is the only channel back to the admin — see `GenerationProgress.messages`.
   */
  const persistMessages = () =>
    updateGenerationProgress(edition.id, (p) => ({ ...p, messages: [...messages] }));

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

  // --- GitHub stats bank (Phase 1 of the github-monthly-stats-extraction
  // plan) — pure arithmetic over the ServiceActivity rows just saved above,
  // so it runs whether or not an AI provider is configured, unlike every
  // AI-generation step below. Never lets a stats bug break the rest of the
  // pipeline: computeGithubStats() itself never throws, but the persistence
  // write still gets its own try/catch, matching every other optional step
  // in this function.
  try {
    const githubStats = await computeGithubStats(edition.id);
    if (githubStats) {
      await prisma.edition.update({
        where: { id: edition.id },
        data: { githubStats: JSON.stringify(githubStats) },
      });
    }
  } catch (error) {
    messages.push({
      type: "warning",
      text: `GitHub stats computation warning: ${describeError(error)}`,
    });
  }

  // --- GitHub topic candidates (Phase 2 of the github-topic-candidates
  // plan) — reads the stats bank just persisted above, so it must run
  // after it. Same "pure computation, no AI provider needed, never let a
  // bug here break the rest of generation" contract as Phase 1.
  try {
    const topicCandidates = await computeTopicCandidates(edition.id);
    if (topicCandidates) {
      await prisma.edition.update({
        where: { id: edition.id },
        data: { topicCandidates: JSON.stringify(topicCandidates) },
      });
    }
  } catch (error) {
    messages.push({
      type: "warning",
      text: `Topic candidate computation warning: ${describeError(error)}`,
    });
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
  // Flush the source-fetch warnings before the slow half starts, so they show
  // up in the edit page while the articles are still being written.
  await persistMessages();
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
  await persistMessages();

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

  // --- Topic-candidate article generation (github-insights-curation plan) ---
  // Auto-writes one article per topic candidate that clears the score
  // threshold, with no admin action required. Same `aiModel` gate as the two
  // rankings above — without a configured provider there's nothing to
  // generate with. Per-candidate failures are already handled (and pushed to
  // `messages`) inside `generateTopicCandidateArticles`; this outer catch is
  // just the same defense-in-depth every other optional step here has.
  if (aiModel) {
    try {
      const topicCandidateArticles = await generateTopicCandidateArticles(edition.id, aiModel, messages);
      generatedCount += topicCandidateArticles.length;
    } catch (error) {
      messages.push({
        type: "warning",
        text: `Topic candidate article generation warning: ${describeError(error)}`,
      });
    }
  }

    messages.push({
      type: "success",
      text:
        `Draft edition '${edition.title}' created with ${fetchedCount - spotifyFetched} GitHub/blog/Alexandria events, ` +
        `${spotifyFetched} Spotify items, and ${generatedCount} AI-generated articles.`,
    });
  } finally {
    // The live half of the progress column (source/section state) is done with
    // once `generationStatus` flips, but the warnings have to outlive it: they
    // are the only place the admin ever sees what went wrong, and the route
    // that started this responded long ago. Everything else is reset to an
    // empty progress so the edit page renders its article list exactly as it
    // does for an edition that was never generated in-browser — and a run with
    // nothing to report clears the column outright, as before.
    const notable = messages.filter((message) => message.type !== "success");
    await prisma.edition.update({
      where: { id: edition.id },
      data: {
        generationStatus: "done",
        generationProgress:
          notable.length > 0
            ? JSON.stringify({ ...initialGenerationProgress(), messages: notable })
            : null,
      },
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
