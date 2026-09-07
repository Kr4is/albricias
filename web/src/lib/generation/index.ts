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
 * Every function takes an optional `apiKey`; when omitted the Mastra model
 * router falls back to `OPENAI_API_KEY`, which is how the Flask admin routes
 * sourced it too.
 */

import type { Article, Edition } from "@/generated/prisma/client";
import { defaultEditionTitle, defaultEditionVol } from "@/lib/cadence";
import { getSetting } from "@/lib/config/settings";
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
import { chronicleAgent, parseResponse, runNewspaperAgent } from "@/mastra/agents";
import { createActivityRankingArticle, createCalendarRankingArticle } from "@/lib/rankings";
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
  apiKey,
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
      apiKey: apiKey ?? (await requireOpenAiKey()),
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

async function requireOpenAiKey(): Promise<string> {
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
 * Run the full "Generate edition" pipeline for `[periodStart, periodEnd)`
 * under `cadence`: fetch GitHub/blog/Spotify activity for the period, create
 * the draft `Edition`, and call {@link generateEditionDraft} on it.
 *
 * Ported out of `web/src/app/admin/editions/generate/route.ts`'s POST handler
 * verbatim (same per-source try/catch + non-fatal warning pattern, same
 * final summary message), generalised to take an already-resolved period
 * instead of reading one off a `FormData`. If an edition already exists for
 * `(cadence, periodStart)` (the same unique constraint the route relied on),
 * nothing is created or fetched — the existing edition is returned as-is so
 * callers (the manual route, or a scheduled run) can no-op safely instead of
 * crashing or duplicating.
 *
 * Callers are responsible for resolving `periodStart`/`periodEnd` (see
 * `resolvePeriodFromForm` for the manual route, `currentPeriodBounds` for the
 * scheduler) and for turning the outcome into a response — this function
 * never redirects or flashes, it only returns data.
 */
export async function runEditionGeneration(
  cadence: Cadence,
  periodStart: Date,
  periodEnd: Date,
): Promise<EditionGenerationOutcome> {
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
    },
  });

  const messages: FlashMessage[] = [];
  let fetchedCount = 0;
  let spotifyFetched = 0;

  // --- GitHub fetch ---
  const [githubToken, githubUsername] = await Promise.all([
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
  ]);
  if (githubToken && githubUsername) {
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
    }
  } else {
    messages.push({
      type: "warning",
      text: "GitHub token/username not configured (/admin/settings) — skipping GitHub fetch.",
    });
  }

  // --- Blog RSS fetch ---
  const blogUrl = await getSetting("integrations.blog.rssUrl");
  if (blogUrl) {
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
    }
  } else {
    messages.push({
      type: "warning",
      text: "Blog RSS URL not configured (/admin/settings) — skipping blog fetch.",
    });
  }

  // --- Spotify fetch ---
  let spotifyToken = await getServiceToken("spotify");
  if (spotifyToken) {
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
    }
  } else {
    messages.push({
      type: "info",
      text: "Spotify not connected — visit /admin/spotify/connect to link your account.",
    });
  }

  // --- Alexandria fetch (reading activity) ---
  const [alexandriaApiUrl, alexandriaApiToken] = await Promise.all([
    getSetting("integrations.alexandria.apiUrl"),
    getSetting("integrations.alexandria.apiToken", { encrypted: true }),
  ]);
  if (alexandriaApiUrl) {
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
    }
  } else {
    messages.push({
      type: "info",
      text: "Alexandria API URL not configured (/admin/settings) — skipping Alexandria fetch.",
    });
  }

  // --- AI generation ---
  let generatedCount = 0;
  const openaiKey = await getSetting("integrations.openai.apiKey", { encrypted: true });
  if (openaiKey && fetchedCount > 0) {
    try {
      const articles = await generateEditionDraft(edition.id, openaiKey);
      generatedCount = articles.length;
    } catch (error) {
      messages.push({ type: "warning", text: `AI writer warning: ${describeError(error)}` });
    }
  } else if (fetchedCount === 0) {
    messages.push({ type: "info", text: "No activity fetched from any service — AI generation skipped." });
  } else {
    messages.push({
      type: "warning",
      text: "OpenAI API key not configured (/admin/settings) — AI generation skipped.",
    });
  }

  // --- Activity ranking (Phase C / Wave 2) ---
  // Only the activity ranking (of the three ranking kinds Phase C adds) is
  // wired into the automatic pipeline — see `web/src/lib/rankings/index.ts`'s
  // doc comment. `createActivityRankingArticle` itself returns `null` (no
  // article, not an error) when the edition has no GitHub-sourced activity to
  // rank, so this always "skips gracefully" per the plan's requirement; the
  // outer `openaiKey` check just avoids the extra query entirely in the
  // no-OPENAI_API_KEY degraded case, same as the AI-generation gate above.
  if (openaiKey) {
    try {
      const rankingArticle = await createActivityRankingArticle(edition.id, openaiKey);
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
  // outer `openaiKey` check is the same no-extra-query optimisation as above.
  if (openaiKey) {
    try {
      const calendarRankingArticle = await createCalendarRankingArticle(edition.id, openaiKey);
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

  return {
    status: "generated",
    edition,
    messages,
    fetchedCount,
    spotifyFetched,
    generatedCount,
  };
}
