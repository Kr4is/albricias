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
import { randomLayoutIndex } from "@/lib/layout";
import { describeError, type FlashMessage } from "@/lib/flash";
import { prisma } from "@/lib/prisma";
import { getServiceToken, isServiceTokenExpired, upsertServiceToken } from "@/lib/service-token";
import { computeGithubStats } from "@/lib/github-stats";
import { generateHeroImage, generateEditionCoverImage } from "@/lib/ai/hero-image";
import { ARTICLE_ORDER } from "@/lib/editions";
import { editionMediaPrefix } from "@/lib/media-upload";
import {
  computeStarCandidates,
  computeTopicCandidates,
  mergeTopicCandidates,
  type CuratedArticleKind,
  type TopicCandidate,
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
import {
  MODEL_NAME,
  chronicleAgent,
  parseResponse,
  profileSectionAgent,
  runNewspaperAgent,
  tutorialSectionAgent,
  type ResolvedAiModel,
} from "@/mastra/agents";
import { stripLeadingHeadingLine } from "@/mastra/agents/base";
import { createActivityRankingArticle, createCalendarRankingArticle } from "@/lib/rankings";
import {
  SYNTHESIS_GENERATOR,
  createEditionSynthesisArticle,
  rebuildEditionSynthesisArticle,
} from "@/lib/synthesis";
import {
  type GenerationTrace,
  type GeneratorResult,
  type GeneratorType,
  type ReviewSubjectType,
  generationTraceSchema,
} from "@/mastra/schemas";
import {
  CHRONICLE_CONCURRENCY,
  type ChronicleCategory,
  assembleProfileContent,
  assistedGenerationWorkflow,
  buildChroniclePrompt,
  chronicleWorkflow,
  groupActivities,
  profileWorkflow,
  summariseGroup,
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

/**
 * Which step of a multi-step workflow the in-flight section is on right now.
 *
 * Only the profile workflow populates this (see {@link applyProfileStepProgress}):
 * it is the one pipeline deep enough — five steps, minutes end to end — that a
 * single "writing…" banner reads as a hang. `label` is resolved server-side and
 * stored verbatim so the client component just prints it; `index`/`total`
 * describe the step's position in the pipeline for a progress indicator.
 */
interface SectionStepProgress {
  id: string;
  label: string;
  index: number;
  total: number;
}

/** Iteration progress *inside* one step — the section `foreach`'s "3 of 8". */
interface SectionSubProgress {
  current: number;
  total: number;
}

interface SectionProgress {
  category: string;
  status: SectionStatus;
  /**
   * Optional: absent on every writer except the profile-workflow streaming
   * path, and absent from every row written before these fields existed, so
   * readers must treat "no step detail" as the normal case.
   */
  step?: SectionStepProgress | null;
  subProgress?: SectionSubProgress | null;
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
 * The profile workflow's steps, in the order `profileWorkflow` chains them
 * (`@/mastra/workflows/profile`: `.then(research).then(outline)
 * .foreach(writeSection).then(writeDataSection).then(assembleArticle)`).
 * These strings are the `createStep({ id })` values Mastra puts on every
 * `workflow-step-*` chunk's `payload.id`, so this list is both the id→position
 * lookup and the guard that keeps an unrecognised step id from being labelled.
 */
const PROFILE_STEP_IDS = [
  "research-repo",
  "build-outline",
  "write-section",
  "write-data-section",
  "assemble-article",
] as const;

type ProfileStepId = (typeof PROFILE_STEP_IDS)[number];

/**
 * Step id → the banner text an admin reads while it runs.
 *
 * English to match the rest of the admin UI (`GenerationWatcher`'s existing
 * "Writing… N of M sections ready.", the generate form, every flash message).
 * A function rather than a string so `write-section` can fold its `foreach`
 * iteration count in, and still say something sensible before the first
 * iteration has reported one.
 */
const PROFILE_STEP_LABELS: Record<ProfileStepId, (sub: SectionSubProgress | null) => string> = {
  "research-repo": () => "Researching the repository…",
  "build-outline": () => "Planning the outline…",
  "write-section": (sub) =>
    sub ? `Writing section ${sub.current} of ${sub.total}…` : "Writing the sections…",
  "write-data-section": () => "Generating the data section…",
  "assemble-article": () => "Assembling the article…",
};

/**
 * Index of the *one* section currently being written, or `-1` when that is
 * ambiguous.
 *
 * Step detail describes a single piece of work, so it only makes sense to stamp
 * it on a lone in-flight section — which is exactly the shape
 * {@link beginSinglePieceRetry} seeds (`sections: [{ status: "writing" }]`) and
 * the only shape the profile workflow ever runs under. Deliberately returns
 * `-1` for every other shape, which makes {@link applyProfileStepProgress} a
 * no-op for the two cases where blindly writing `sections[0]` would be wrong:
 * a chronicle run (several sections `"writing"` at once under
 * `CHRONICLE_CONCURRENCY`) and the bulk topic-candidate pass inside
 * `populateEditionDraft` (where `sections` still holds the chronicle's own,
 * already-settled, entries).
 */
function soleInFlightSectionIndex(progress: GenerationProgress): number {
  let found = -1;
  for (let i = 0; i < progress.sections.length; i += 1) {
    if (progress.sections[i]?.status !== "writing") continue;
    if (found !== -1) return -1;
    found = i;
  }
  return found;
}

/**
 * Record that the profile workflow has moved onto `stepId`, on whichever single
 * section is in flight. Pure, so the streaming loop's fixture test can drive it
 * directly without a database.
 *
 * `subProgress` is carried over when the step id is unchanged: a `foreach`'s
 * `workflow-step-start` fires per iteration, and clearing the count on each one
 * would flicker the banner between "Writing section 2 of 3…" and the
 * countless "Writing the sections…" fallback. A *different* step id clears it,
 * since a count from the previous step means nothing in the new one.
 */
export function applyProfileStepProgress(
  progress: GenerationProgress,
  stepId: string,
  subProgress: SectionSubProgress | null = null,
): GenerationProgress {
  const index = PROFILE_STEP_IDS.indexOf(stepId as ProfileStepId);
  if (index === -1) return progress;
  const target = soleInFlightSectionIndex(progress);
  if (target === -1) return progress;

  const section = progress.sections[target];
  const carried = section.step?.id === stepId ? (section.subProgress ?? null) : null;
  const sub = subProgress ?? carried;

  return {
    ...progress,
    sections: progress.sections.map((entry, i) =>
      i === target
        ? {
            ...entry,
            step: {
              id: stepId,
              label: PROFILE_STEP_LABELS[stepId as ProfileStepId](sub),
              index: index + 1,
              total: PROFILE_STEP_IDS.length,
            },
            subProgress: sub,
          }
        : entry,
    ),
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
  /**
   * When set, updates this existing `Article` row instead of creating a new
   * one — how a topic-candidate retry avoids leaving duplicate rows behind
   * (see {@link findArticleForTopicCandidate}) rather than accumulating one
   * per retry.
   */
  updateArticleId?: number;
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
  updateArticleId,
}: GenerateArticleFromSourceOptions): Promise<Article> {
  // 1. Process source → normalized text.
  let sourceResult: SourceResult;
  /**
   * The `github_repo` branch below fills this in from the picked repo when the
   * caller left it blank — everything else just passes the caller's value
   * through.
   */
  let resolvedSubjectName = subjectName;
  /**
   * Set only on the `github_repo` branch, and only used by the `profile`
   * workflow's non-LLM `research-repo` step — it re-queries GitHub for the
   * facts bundle its data charts are built from, so it needs the same token
   * `fetchGithubRepoSource` used rather than a second lookup of the setting.
   */
  let githubSourceToken = "";
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
    githubSourceToken = token;
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
  //
  // `profile` goes through its own outline-then-sections workflow instead of
  // `assistedGenerationWorkflow`'s single-call branch — see
  // `@/mastra/workflows/profile`'s doc comment for why. Called directly here
  // rather than composed as a nested step inside `assistedGenerationWorkflow`'s
  // `.branch()`, since nested-workflow-as-step support isn't something to bet
  // this feature's whole plumbing on.
  let result: GeneratorResult;
  if (generatorType === "profile") {
    const run = await profileWorkflow.createRun();
    // `run.stream()` rather than `run.start()` purely to read the workflow's
    // own step events as they happen — same pattern (and same `stream.result`
    // for the final outcome) `generateEditionDraft` uses for the chronicle
    // workflow. The inputs, the result, and the error handling below are
    // identical to what `run.start()` did; only the progress column is new.
    // The workflow's header comment called this "no live view to feed", which
    // stopped being true once it grew from one call into five steps.
    const stream = run.stream({
      inputData: {
        text: sourceResult.text,
        subjectName: resolvedSubjectName,
        topicHint,
        aiModel,
        // Only the `github_repo` branch fills these in; everywhere else the
        // research step finds nothing to fetch and the pipeline runs on the
        // supplied text alone, exactly as it did before.
        githubRepo: sourceType === "github_repo" ? (githubRepo ?? "") : "",
        githubToken: githubSourceToken,
        homepage:
          typeof sourceResult.metadata.homepage === "string" ? sourceResult.metadata.homepage : null,
      },
    });

    for await (const chunk of stream.fullStream) {
      if (chunk.type === "workflow-step-start") {
        await updateGenerationProgress(editionId, (progress) =>
          applyProfileStepProgress(progress, chunk.payload.id),
        );
      } else if (
        chunk.type === "workflow-step-progress" &&
        chunk.payload.id === "write-section"
      ) {
        // The section `foreach`'s per-iteration report. `currentIndex` names
        // the iteration that just *finished* (Mastra's own doc comment on the
        // chunk type), so the section actually being written now is
        // `completedCount + 1` — clamped, because the last iteration's event
        // arrives when nothing is left to write and `assemble-article`'s
        // `workflow-step-start` has not replaced this label yet.
        const { completedCount, totalCount } = chunk.payload;
        await updateGenerationProgress(editionId, (progress) =>
          applyProfileStepProgress(progress, "write-section", {
            current: Math.min(completedCount + 1, totalCount),
            total: totalCount,
          }),
        );
      }
      // `workflow-step-result` is deliberately ignored: the next step's
      // `workflow-step-start` already supersedes the finished step's label, and
      // the terminal state of the column belongs to whoever seeded it (see
      // `finishSinglePieceRetry`), not to this loop.
    }

    const outcome = await stream.result;
    if (outcome.status !== "success") {
      throw new Error(
        `Profile generation failed (${outcome.status})`,
        outcome.status === "failed" ? { cause: outcome.error } : undefined,
      );
    }
    result = outcome.result;
  } else {
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
    result = outcome.result;
  }

  // 3. Persist the Article.
  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  const date = articleDate ?? edition?.periodStart ?? new Date();

  // Hero image: prefer whatever real, attributable image the source turned
  // up (a project's own og:image/README logo/GitHub social card — see
  // `SourceResult.imageUrl`); only generate one with AI when nothing real
  // was available at all, matching the "real first, AI as a last resort"
  // call for this feature.
  const image =
    sourceResult.imageUrl ??
    (edition
      ? await generateHeroImage({
          title: result.title,
          subject: resolvedSubjectName,
          editionPrefix: editionMediaPrefix(edition),
        })
      : null);

  const sourceData = JSON.stringify({
    ...result.sourceData,
    source_type: sourceType,
    source_metadata: sourceResult.metadata,
    transcription: sourceResult.text,
    ...extraSourceData,
  });

  // Updating an existing row (a topic-candidate retry — see
  // `findArticleForTopicCandidate`) instead of always creating a new one:
  // this is what stops a retry from leaving duplicate articles behind for
  // the same candidate, which is what actually happened, repeatedly, in
  // testing before this was added. `order` is deliberately left alone here
  // — a retried article keeps its position in the edition rather than
  // jumping to the end.
  if (updateArticleId) {
    return prisma.article.update({
      where: { id: updateArticleId },
      data: {
        title: result.title,
        content: result.content,
        category: result.category,
        author,
        deck: deckFor(result.content),
        date,
        image,
        sourceData,
      },
    });
  }

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
      image,
      sourceType: AI_SOURCE_TYPE,
      sourceData,
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
 * `interview` has no entry because it isn't a `CuratedArticleKind` at all —
 * it needs a real conversation to transcribe, which no topic candidate has.
 *
 * `star` maps to `profile`: `PROFILE_SYSTEM`'s "long-form narrative
 * journalism... their background, what makes them remarkable" framing fits a
 * starred-repo deep dive far better than any of the other five generator
 * types, which are all shaped around GitHub activity (a release, a bugfix, a
 * burst of commits) rather than a single project taken on its own.
 */
const TOPIC_CANDIDATE_GENERATOR_TYPE: Record<CuratedArticleKind, GeneratorType> = {
  release: "review",
  bugfixStory: "reflection",
  newLanguage: "tutorial",
  concentration: "profile",
  streak: "profile",
  fastPrVelocity: "profile",
  externalContribution: "profile",
  curiosity: "reflection",
  star: "profile",
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
/**
 * `star` candidates always qualify — see `computeStarCandidates`'s doc
 * comment on why a starred repo has no heuristic score to compare against
 * the threshold in the first place. Exported so both the bulk pass below and
 * {@link computeMissingGenerationPieces} (the durable "what's missing" diff
 * the edit page renders) agree on exactly which candidates are expected to
 * have an article.
 */
export function qualifiesForAutoGeneration(candidate: TopicCandidate): boolean {
  return candidate.kind === "star" || candidate.score >= TOPIC_CANDIDATE_AUTO_GENERATE_THRESHOLD;
}

/**
 * Find the existing article (if any) a topic candidate already produced —
 * same JSON-parse-and-filter-by-`topicCandidateId` logic
 * {@link computeMissingGenerationPieces} uses to detect a *missing* one,
 * reused here to detect an *existing* one so a retry updates it in place
 * instead of leaving a duplicate behind. Confirmed necessary, not
 * theoretical: retrying the same candidate repeatedly (before this existed)
 * produced literal duplicate articles in testing.
 */
async function findArticleForTopicCandidate(
  editionId: number,
  candidateId: string,
): Promise<Article | null> {
  const articles = await prisma.article.findMany({ where: { editionId, sourceType: AI_SOURCE_TYPE } });
  return (
    articles.find((article) => parseSourceData(article.sourceData).topicCandidateId === candidateId) ??
    null
  );
}

/**
 * Generate the one `Article` a single topic candidate is owed. Pulled out of
 * {@link generateTopicCandidateArticles}'s loop so a later single-candidate
 * retry (`regenerateTopicCandidateArticle`, for the edit page's per-item
 * "failed, retry" card) calls the exact same code the bulk auto-generation
 * pass does, instead of a second copy that could drift. Looks up an
 * existing article for this candidate unconditionally — a no-op for the
 * bulk pass (nothing exists yet), the fix for a retry (see
 * {@link findArticleForTopicCandidate}). Exported (rather than kept
 * module-private like most of this file's helpers) specifically so
 * `@/lib/generation/daily`'s per-day job can call it directly for whichever
 * candidate ids its topic-candidate diff finds newly surfaced that day,
 * without a second implementation.
 */
export async function generateOneTopicCandidateArticle(
  editionId: number,
  candidate: TopicCandidate,
  aiModel: ResolvedAiModel | undefined,
): Promise<Article> {
  const repo = candidate.repos[0];
  if (!repo) {
    throw new Error(
      `Topic candidate "${candidate.title}" (${candidate.kind}) has no repo to write about.`,
    );
  }
  const existing = await findArticleForTopicCandidate(editionId, candidate.id);
  return generateArticleFromSource({
    editionId,
    sourceType: "github_repo",
    generatorType: TOPIC_CANDIDATE_GENERATOR_TYPE[candidate.kind],
    githubRepo: repo,
    aiModel,
    extraSourceData: { topicCandidateId: candidate.id },
    updateArticleId: existing?.id,
  });
}

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
  const qualifying = candidates.filter(qualifiesForAutoGeneration);

  const created: Article[] = [];
  for (const candidate of qualifying) {
    try {
      created.push(await generateOneTopicCandidateArticle(editionId, candidate, aiModel));
    } catch (error) {
      messages.push({
        type: "warning",
        text: `Topic candidate article generation warning ("${candidate.title}"): ${describeError(error)}`,
      });
    }
  }
  return created;
}

/**
 * Retry a single topic candidate that qualified for auto-generation but
 * never got its article (see `computeMissingGenerationPieces`) — the
 * backend half of the edit page's per-candidate "failed, retry" card.
 * Throws if the candidate id isn't in the edition's stored `topicCandidates`.
 */
export async function regenerateTopicCandidateArticle(
  editionId: number,
  candidateId: string,
  aiModel: ResolvedAiModel | undefined,
): Promise<Article> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { topicCandidates: true },
  });
  const candidate = parseStoredTopicCandidates(edition?.topicCandidates).find(
    (c) => c.id === candidateId,
  );
  if (!candidate) {
    throw new Error(`Topic candidate "${candidateId}" not found on edition ${editionId}.`);
  }
  return generateOneTopicCandidateArticle(editionId, candidate, aiModel);
}

/**
 * Retry one chronicle section that had activity but never got a written
 * article — the backend half of the edit page's per-section "failed, retry"
 * card. Reuses the same prompt-building primitives `generateEditionDraft`'s
 * chronicle pass does (`groupActivities`/`summariseGroup`/
 * `buildChroniclePrompt`, all from `@/mastra/workflows`), just for one
 * category instead of the whole activity set, and persists the result the
 * same way that pass does. Throws if the category has no activity to write
 * from (nothing to regenerate) — mirrors `regenerateArticle`'s "throws if
 * the target doesn't exist" contract.
 */
export async function regenerateChronicleSection(
  editionId: number,
  category: ChronicleCategory,
  aiModel: ResolvedAiModel | undefined,
): Promise<Article> {
  const [activities, edition] = await Promise.all([
    prisma.serviceActivity.findMany({ where: { editionId, eventType: { not: "star" } } }),
    prisma.edition.findUnique({ where: { id: editionId } }),
  ]);
  const label = edition ? periodLabel(edition) : "this month";

  const activityInputs = activities.map((row) => ({
    eventType: row.eventType,
    repo: row.repo,
    title: row.title,
    url: row.url,
    timestamp: row.timestamp,
  }));
  const group = groupActivities(activityInputs).get(category);
  if (!group || group.length === 0) {
    throw new Error(`No activity to write the "${category}" section from.`);
  }

  const prompt = buildChroniclePrompt(category, label, summariseGroup(group));
  const raw = await runNewspaperAgent(chronicleAgent, { user: prompt, aiModel });
  const { title, content } = parseResponse(raw, `${category} Dispatch — ${label}`);

  return prisma.article.create({
    data: {
      editionId,
      title,
      content,
      category,
      author: DEFAULT_AUTHOR,
      deck: deckFor(content),
      order: await nextArticleOrder(editionId),
      date: edition?.periodStart ?? new Date(),
      sourceType: AI_SOURCE_TYPE,
      sourceData: JSON.stringify({
        generator: "chronicle",
        prompt,
        response: raw,
        model: MODEL_NAME,
        activity_count: group.length,
      }),
    },
  });
}

/**
 * Retry just one section of a profile article written by the outline→
 * sections workflow (`@/mastra/workflows/profile`) — the backend half of
 * the edit page's per-section "Retry this section" button in the
 * generation-trace graph. Everything the retry needs is already sitting in
 * the stored trace: the section's own already-built prompt (the outline
 * brief and source excerpt baked in, same as the original run used) is
 * replayed as-is rather than reconstructed, so this needs no access to the
 * article's source material at all — only its own `sourceData`.
 *
 * Re-joins the article the same way `assemble-article` did, with this one
 * section's new draft swapped in, and writes back an *updated* `Article`
 * row (`prisma.article.update`, `regenerateArticle`'s pattern) — never a new
 * one. Throws if the retried call fails again, but only after persisting
 * the failure into the trace, so the graph reflects what just happened
 * either way; `finishSinglePieceRetry` turns that throw into a flash
 * message the same way every other single-piece retry's failure already
 * does.
 */
export async function regenerateProfileSection(
  articleId: number,
  sectionIndex: number,
  aiModel: ResolvedAiModel | undefined,
): Promise<Article> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) {
    throw new Error(`Article ${articleId} not found.`);
  }

  const source = parseSourceData(article.sourceData);
  const parsedTrace = generationTraceSchema.safeParse(source.generationTrace);
  if (!parsedTrace.success) {
    throw new Error(`Article ${articleId} has no profile generation trace to retry a section of.`);
  }
  const trace = parsedTrace.data;
  const sectionIdx = trace.sections.findIndex((section) => section.index === sectionIndex);
  if (sectionIdx === -1) {
    throw new Error(`Article ${articleId}'s trace has no section at index ${sectionIndex}.`);
  }
  const section = trace.sections[sectionIdx];

  const startedAt = new Date().toISOString();
  let newResponse: string | null = null;
  let retryError: string | undefined;
  try {
    // Retry with the writer that produced this section, not always the
    // narrative one — otherwise retrying the tutorial section silently
    // replaces its runnable steps with prose.
    const agent = section.kind === "tutorial" ? tutorialSectionAgent : profileSectionAgent;
    const raw = (await runNewspaperAgent(agent, { user: section.prompt, aiModel })).trim();
    newResponse = stripLeadingHeadingLine(raw);
    // The data section's stored response is narration *plus* code-generated
    // ` ```chart ` blocks (see `write-data-section`), and only the narration
    // gets regenerated here — the charts came from a facts bundle this
    // replay-only path deliberately has no access to. Carry the old blocks
    // over verbatim rather than dropping real-data charts on a text retry.
    if (section.kind === "data") {
      const charts = (section.response ?? "").match(/```chart\n[\s\S]*?\n```/g) ?? [];
      if (charts.length > 0) newResponse = [newResponse, ...charts].filter(Boolean).join("\n\n");
    }
  } catch (error) {
    retryError = error instanceof Error ? error.message : String(error);
  }
  const endedAt = new Date().toISOString();

  const updatedSections: GenerationTrace["sections"] = trace.sections.map((s, i) =>
    i === sectionIdx
      ? {
          ...s,
          status: newResponse !== null ? "success" : "failed",
          // A failed retry normally clears the section's stored response — it
          // no longer describes anything. The data section is the exception:
          // its response is the *only* surviving copy of the ` ```chart `
          // blocks built in code from the repo's real facts bundle, which this
          // replay-only path cannot rebuild (see the `section.kind === "data"`
          // branch above). Clearing it on a failed model call would destroy
          // real fetched data over a transient proxy error, unrecoverable short
          // of regenerating the whole article. Every other kind keeps the
          // pre-existing wipe-on-failure behaviour.
          response: newResponse ?? (s.kind === "data" ? s.response : undefined),
          startedAt,
          endedAt,
          error: retryError,
        }
      : s,
  );

  // Rebuilt through the workflow's own assembler rather than a local re-join,
  // so a single-section retry can't quietly drop the article's table of
  // contents (which only `assembleProfileContent` knows how to build, with
  // anchors that have to match `renderMarkdown`'s heading ids).
  const content = assembleProfileContent(
    trace.outline.premise,
    updatedSections.map((s) => ({
      heading: s.heading,
      // A failed section contributes a placeholder, not a body — except the
      // data section, whose preserved response still holds real-data charts
      // even when its narration retry failed. Behaviour is unchanged for every
      // other kind: a failed one has no response to fall back to anyway.
      markdown:
        s.status === "success" || s.kind === "data" ? (s.response ?? null) : null,
    })),
  );

  const succeeded = updatedSections.filter((s) => s.status === "success").length;
  const updatedTrace: GenerationTrace = {
    ...trace,
    endedAt,
    status: succeeded === updatedSections.length ? "success" : succeeded > 0 ? "partial" : "failed",
    sections: updatedSections,
  };

  const updated = await prisma.article.update({
    where: { id: articleId },
    data: {
      content,
      deck: deckFor(content),
      sourceData: JSON.stringify({ ...source, generationTrace: updatedTrace }),
    },
  });

  if (retryError) {
    throw new Error(`Section "${section.heading}" failed again: ${retryError}`);
  }
  return updated;
}

/**
 * What the edit page needs to render "failed, retry" cards for — computed
 * fresh from durable data (`ServiceActivity`, `Article`, `Edition.
 * topicCandidates`) rather than from `Edition.generationProgress`, which
 * `populateEditionDraft` clears the moment a run ends (see that function's
 * `finally` block). This is what makes a failure still visible — and
 * retriable — on a page load long after the run that caused it finished.
 *
 * Only meaningful once generation has actually run at least once; callers
 * should gate on `edition.generationStatus === "done"` themselves (a
 * never-generated edition has no activity to diff against and would just
 * report everything as "missing", which is not what a blank draft means).
 */
export async function computeMissingGenerationPieces(editionId: number): Promise<{
  missingSections: ChronicleCategory[];
  missingCandidates: TopicCandidate[];
  missingActivityRanking: boolean;
}> {
  const [activities, articles, edition, githubActivityCount] = await Promise.all([
    prisma.serviceActivity.findMany({
      where: { editionId, eventType: { not: "star" } },
      select: { eventType: true, repo: true, title: true, url: true, timestamp: true },
    }),
    prisma.article.findMany({
      where: { editionId, sourceType: AI_SOURCE_TYPE },
      select: { category: true, sourceData: true },
    }),
    prisma.edition.findUnique({ where: { id: editionId }, select: { topicCandidates: true } }),
    // Same gate `createActivityRankingArticle` itself uses (source: "github",
    // not just any activity) — an edition with no GitHub rows was never
    // going to get a ranking article, automatic pass or not, so it isn't
    // "missing" one.
    prisma.serviceActivity.count({ where: { editionId, source: "github" } }),
  ]);

  const expectedCategories = groupActivities(activities).keys();
  const writtenCategories = new Set(articles.map((a) => a.category));
  const missingSections = [...expectedCategories].filter(
    (category) => !writtenCategories.has(category),
  );

  const sourceDatas = articles
    .map((a) => {
      try {
        return a.sourceData ? (JSON.parse(a.sourceData) as { topicCandidateId?: string; generator?: string }) : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((data): data is { topicCandidateId?: string; generator?: string } => Boolean(data));

  const generatedCandidateIds = new Set(
    sourceDatas
      .map((data) => data.topicCandidateId)
      .filter((id): id is string => Boolean(id)),
  );
  const missingCandidates = parseStoredTopicCandidates(edition?.topicCandidates).filter(
    (candidate) => qualifiesForAutoGeneration(candidate) && !generatedCandidateIds.has(candidate.id),
  );

  const hasActivityRanking = sourceDatas.some((data) => data.generator === "activity-ranking");
  const missingActivityRanking = githubActivityCount > 0 && !hasActivityRanking;

  return { missingSections, missingCandidates, missingActivityRanking };
}

// ---------------------------------------------------------------------------
// Single-piece retry with durable, reload-proof progress — a section or
// topic-candidate retry can legitimately run for minutes against a slow
// self-hosted model, and a client-side "this button is disabled with a
// spinner" state is lost the moment the page is reloaded or left and
// returned to. Reuses `Edition.generationStatus`/`generationProgress` (and
// therefore the existing `/live` SSE route + `GenerationWatcher`) exactly
// the way `populateEditionDraft` does for the bulk pipeline, just seeded
// with a single section — no new transport or UI needed, the admin sees the
// same "Writing…" placeholder and it survives a reload the same way.
// ---------------------------------------------------------------------------

/**
 * Flip the edition to `generationStatus: "running"` with a one-item
 * `generationProgress.sections`, or refuse if a run (bulk or another single
 * retry) is already in progress — two writers racing the same column would
 * otherwise clobber each other. Call synchronously from the route, before
 * `after()`, so the admin's very next page load already shows "writing".
 */
async function beginSinglePieceRetry(
  editionId: number,
  label: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { generationStatus: true },
  });
  if (!edition) return { ok: false, reason: "Edition not found." };
  if (edition.generationStatus === "running") {
    return {
      ok: false,
      reason: "Generation is already in progress for this edition — wait for it to finish, then retry.",
    };
  }
  await prisma.edition.update({
    where: { id: editionId },
    data: {
      generationStatus: "running",
      generationProgress: JSON.stringify({
        ...initialGenerationProgress(),
        totalSections: 1,
        sections: [{ category: label, status: "writing" }],
      }),
    },
  });
  return { ok: true };
}

/**
 * Run `work`, then flip back to `generationStatus: "done"` — same "clear
 * generationProgress unless there's something notable to say" rule
 * `populateEditionDraft`'s `finally` block uses, except a single retry's own
 * failure always counts as notable (there's no separate synchronous flash to
 * carry it, unlike the bulk pipeline's immediate "Generating…" response).
 * Call from the route's `after()`, after `beginSinglePieceRetry` succeeded.
 *
 * `work` may return extra messages to persist alongside any failure — how a
 * caller whose synchronous response was sent long ago still gets a note in
 * front of the admin (see {@link finishManualArticleGeneration}). Existing
 * callers return nothing and are unaffected.
 */
async function finishSinglePieceRetry(
  editionId: number,
  work: () => Promise<FlashMessage[] | void>,
): Promise<void> {
  const messages: FlashMessage[] = [];
  try {
    const extra = await work();
    if (extra) messages.push(...extra);
  } catch (error) {
    messages.push({ type: "error", text: `AI regeneration failed: ${describeError(error)}` });
  }
  await prisma.edition.update({
    where: { id: editionId },
    data: {
      generationStatus: "done",
      generationProgress:
        messages.length > 0 ? JSON.stringify({ ...initialGenerationProgress(), messages }) : null,
    },
  });
}

/** Begin half of a chronicle-section retry — see {@link beginSinglePieceRetry}. */
export async function beginChronicleSectionRetry(
  editionId: number,
  category: ChronicleCategory,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return beginSinglePieceRetry(editionId, category);
}

/** Finish half of a chronicle-section retry — call from the route's `after()`. */
export async function finishChronicleSectionRetry(
  editionId: number,
  category: ChronicleCategory,
  aiModel: ResolvedAiModel | undefined,
): Promise<void> {
  await finishSinglePieceRetry(editionId, async () => {
    await regenerateChronicleSection(editionId, category, aiModel);
  });
}

/**
 * Begin half of a topic-candidate retry — see {@link beginSinglePieceRetry}.
 * Looks the candidate up first (for its title, used as the progress label,
 * and to 404 early) rather than deferring that to the `after()` half, so a
 * bad id fails the synchronous request instead of silently flipping the
 * edition to "running" for nothing.
 */
export async function beginTopicCandidateRetry(
  editionId: number,
  candidateId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const edition = await prisma.edition.findUnique({
    where: { id: editionId },
    select: { topicCandidates: true },
  });
  const candidate = parseStoredTopicCandidates(edition?.topicCandidates).find((c) => c.id === candidateId);
  if (!candidate) {
    return { ok: false, reason: `Topic candidate "${candidateId}" not found.` };
  }
  return beginSinglePieceRetry(editionId, candidate.title);
}

/** Finish half of a topic-candidate retry — call from the route's `after()`. */
export async function finishTopicCandidateRetry(
  editionId: number,
  candidateId: string,
  aiModel: ResolvedAiModel | undefined,
): Promise<void> {
  await finishSinglePieceRetry(editionId, async () => {
    await regenerateTopicCandidateArticle(editionId, candidateId, aiModel);
  });
}

/**
 * Begin half of an Activity Ranking retry — see {@link beginSinglePieceRetry}.
 * Unlike a chronicle section or a topic candidate, there's at most one of
 * these per edition, so the label is fixed rather than derived from an id.
 */
export async function beginActivityRankingRetry(
  editionId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return beginSinglePieceRetry(editionId, "Activity Ranking");
}

/** Finish half of an Activity Ranking retry — call from the route's `after()`. */
export async function finishActivityRankingRetry(
  editionId: number,
  aiModel: ResolvedAiModel | undefined,
): Promise<void> {
  await finishSinglePieceRetry(editionId, async () => {
    const article = await createActivityRankingArticle(editionId, aiModel);
    if (!article) {
      throw new Error("No GitHub activity recorded for this edition — nothing to rank.");
    }
  });
}

/**
 * Begin half of a profile-section retry — see {@link beginSinglePieceRetry}.
 * Looks the article and section up first (for the progress label, and to
 * 404 early) the same way {@link beginTopicCandidateRetry} does.
 */
export async function beginArticleSectionRetry(
  editionId: number,
  articleId: number,
  sectionIndex: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article || article.editionId !== editionId) {
    return { ok: false, reason: `Article ${articleId} not found on this edition.` };
  }
  const trace = generationTraceSchema.safeParse(parseSourceData(article.sourceData).generationTrace);
  const section = trace.success ? trace.data.sections.find((s) => s.index === sectionIndex) : undefined;
  if (!section) {
    return { ok: false, reason: `No section ${sectionIndex} found in this article's generation trace.` };
  }
  // `finishArticleSectionRetry` only knows `regenerateProfileSection`, which
  // always writes in the profile workflow's single-repo-deep-dive voice. A day
  // post shares the trace *shape* but not the voice, so retrying one section of
  // it here would quietly produce a paragraph that doesn't belong. The graph
  // hides the button for these; this covers a stale tab or a direct POST.
  if (trace.success && trace.data.workflowId === "day-post") {
    return {
      ok: false,
      reason: "Sections of a day post can't be retried individually — use “Regenerate post” on the day page.",
    };
  }
  return beginSinglePieceRetry(editionId, `${article.title} — ${section.heading}`);
}

/** Finish half of a profile-section retry — call from the route's `after()`. */
export async function finishArticleSectionRetry(
  editionId: number,
  articleId: number,
  sectionIndex: number,
  aiModel: ResolvedAiModel | undefined,
): Promise<void> {
  await finishSinglePieceRetry(editionId, async () => {
    await regenerateProfileSection(articleId, sectionIndex, aiModel);
  });
}

/**
 * Begin half of a manual "Generate article" run — see
 * {@link beginSinglePieceRetry}.
 *
 * The manual form used to call {@link generateArticleFromSource} inline in its
 * POST handler and hold the admin's browser open for the whole run, which for a
 * `profile` piece is five workflow steps and minutes of model time with no
 * feedback whatsoever. Seeding the column here instead puts it on the same
 * durable, reload-proof `/live` SSE rail as every other long-running piece.
 */
export async function beginManualArticleGeneration(
  editionId: number,
  label: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return beginSinglePieceRetry(editionId, label);
}

/**
 * Finish half of a manual "Generate article" run — call from the route's
 * `after()`. `extraMessages` carries anything the route could no longer say in
 * a redirect flash now that it responds before the work runs.
 */
export async function finishManualArticleGeneration(
  options: GenerateArticleFromSourceOptions,
  extraMessages: (article: Article) => FlashMessage[] = () => [],
): Promise<void> {
  await finishSinglePieceRetry(options.editionId, async () => {
    const article = await generateArticleFromSource(options);
    return extraMessages(article);
  });
}

/**
 * Recover any edition left in `generationStatus: "running"` by a server
 * process that died mid-generation — a crash, a `next dev` restart, a
 * redeploy — before it ever reached the code (the `finally` in
 * `populateEditionDraft`, or {@link finishSinglePieceRetry}) that would have
 * flipped it back to `"done"`. Called once from `instrumentation.ts` on
 * server boot, before any request is served, so a stuck row is never left
 * stuck longer than one restart — the exact case an admin has no way to
 * recover from otherwise short of editing the database by hand.
 *
 * There is no in-flight work to resume: whatever `after()` callback or
 * chronicle call was running belonged to the process that's now gone, and
 * its HTTP request to the AI provider died with it. So this doesn't try to
 * pick that back up — it flips the row back to `"done"` with a message
 * explaining what happened, which is what lets the edit page's existing
 * durable missing-piece detection (`computeMissingGenerationPieces`) and
 * its retry cards take over for whatever never finished, the same recovery
 * path an ordinary failure already has. Not a special case, just this
 * failure mode's route into the one that already exists.
 */
export async function recoverStuckGenerations(): Promise<void> {
  const stuck = await prisma.edition.findMany({
    where: { generationStatus: "running" },
    select: { id: true, title: true },
  });

  for (const edition of stuck) {
    console.warn(
      `[generation] Recovering edition ${edition.id} ("${edition.title}") — ` +
        `left "running" by a previous server process.`,
    );
    await prisma.edition.update({
      where: { id: edition.id },
      data: {
        generationStatus: "done",
        generationProgress: JSON.stringify({
          ...initialGenerationProgress(),
          messages: [
            {
              type: "warning",
              text:
                "Generation was interrupted (the server restarted mid-run) — " +
                "anything not yet written can be retried below.",
            },
          ],
        }),
      },
    });
  }
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

  // Stars no longer feed the chronicle roundup — each one gets its own
  // deep-dive article instead, via the topic-candidate pipeline
  // (`computeStarCandidates` + `generateTopicCandidateArticles`, wired in
  // `populateEditionDraft`). Filtered out here rather than in
  // `groupActivities` so this stays the one place that decides what the
  // chronicle sees.
  const activityInputs = activities
    .filter((row) => row.eventType !== "star")
    .map((row) => ({
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

  // The compendium is not regenerated by replaying its stored prompt: that
  // prompt embeds a digest of the edition as it stood when the article was
  // written. Rebuilding re-reads the edition instead, which is what makes
  // Regenerate the way curation changes (an unmarked topic candidate, say)
  // reach an already-written compendium.
  if (source.generator === SYNTHESIS_GENERATOR) {
    return rebuildEditionSynthesisArticle(article, aiModel);
  }

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
 * The returned edition's `generationStatus` is `"done"` — an empty draft
 * with nothing in progress, not `"running"`. This used to be `"running"`,
 * on the assumption the caller would immediately call
 * {@link populateEditionDraft} in the same request; under the daily-
 * incremental model that's no longer guaranteed (the period-creation
 * cron, `@/lib/scheduler`, creates the draft and stops — the *daily* cron
 * is what populates it, possibly hours later), and leaving the row
 * `"running"` with nothing actually running would make the edit page's
 * live-progress view lie. `@/lib/generation/daily`'s `processYesterdayIfNeeded`
 * (called either by the daily cron or, for the manual "Generate edition"
 * button, right after this — see
 * `web/src/app/admin/editions/generate/route.ts`) flips it to `"running"`
 * itself once real work actually starts.
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
      generationStatus: "done",
      layoutVariant: randomLayoutIndex(),
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
  //
  // Star candidates (one per starred repo, see `computeStarCandidates`'s doc
  // comment) are computed independently of the stats-bank-derived detector
  // candidates above — straight from the `ServiceActivity` rows the GitHub
  // fetch just saved — and merged into the same stored array so both kinds
  // share the existing "GitHub Insights" curation UI and mark/unmark toggle.
  try {
    const [topicCandidates, starCandidates] = await Promise.all([
      computeTopicCandidates(edition.id),
      computeStarCandidates(edition.id),
    ]);
    const fresh = [...(topicCandidates ?? []), ...starCandidates];
    if (fresh.length > 0) {
      const current = await prisma.edition.findUnique({
        where: { id: edition.id },
        select: { topicCandidates: true },
      });
      const merged = mergeTopicCandidates(parseStoredTopicCandidates(current?.topicCandidates), fresh);
      await prisma.edition.update({
        where: { id: edition.id },
        data: { topicCandidates: JSON.stringify(merged) },
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

  // Last flush before the pipeline's single largest prompt: everything above
  // has reported by now, and the synthesis call below is the longest stretch
  // where a warning would otherwise sit unpersisted until the `finally`.
  await persistMessages();

  // --- Cross-source synthesis (cross-source-synthesis-compendium plan) ---
  // Runs last on purpose: it digests what every step above persisted and
  // writes the edition's lead article from it. Returns `null` (no article, not
  // an error) when there is too little to synthesise, so this skips gracefully
  // exactly like the two rankings; the `aiModel` gate is the same one they use.
  if (aiModel) {
    try {
      const synthesisArticle = await createEditionSynthesisArticle(edition.id, aiModel);
      if (synthesisArticle) generatedCount += 1;
    } catch (error) {
      messages.push({ type: "warning", text: `Edition synthesis warning: ${describeError(error)}` });
    }
  }

  // --- Edition cover image ---
  // Themed on the month's own articles, so it has to run last, after
  // everything above has actually written some. `generateEditionCoverImage`
  // degrades to `null` the same way `generateHeroImage` does (no OpenAI key,
  // a failed request) — this is enrichment, never a reason to fail the run.
  if (generatedCount > 0) {
    try {
      const articles = await prisma.article.findMany({
        where: { editionId: edition.id },
        select: { title: true },
        orderBy: [...ARTICLE_ORDER],
        take: 6,
      });
      const coverImage = await generateEditionCoverImage({
        editionTitle: edition.title,
        articleTitles: articles.map((article) => article.title),
        editionPrefix: editionMediaPrefix(edition),
      });
      if (coverImage) {
        await prisma.edition.update({ where: { id: edition.id }, data: { coverImage } });
      }
    } catch (error) {
      messages.push({ type: "warning", text: `Edition cover image warning: ${describeError(error)}` });
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
