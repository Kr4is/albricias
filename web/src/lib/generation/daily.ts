/**
 * Daily-incremental edition generation — replaces the old whole-period
 * batch pipeline (`populateEditionDraft`, kept in `./index.ts` unused for
 * now rather than deleted) with a job that processes one calendar day at a
 * time: fetch that day's activity, surface anything newly interesting
 * (star profiles, other topic candidates), write one dispatch article for
 * the day, and — on the period's last day — run the existing activity
 * ranking and front-page synthesis once over everything accumulated.
 *
 * A day with no non-star activity gets no dispatch and no LLM call at all
 * — "nothing happened" is a plain count check, not a model decision.
 *
 * Narrow, disjoint `[dayStart, dayEnd)` fetch ranges (one UTC calendar day)
 * are what make this safe to re-run without a real dedup mechanism: the
 * source APIs can't return the same event twice for non-overlapping
 * ranges. `Edition.lastProcessedDay` tracks how far this has gotten, so a
 * server outage of any length is just caught up on the next run — this
 * file's one entry point, {@link processMissedDays}, walks every day from
 * there to today (or the period's end, whichever is sooner) in order.
 *
 * One-way dependency on `./index.ts` (imports `generateOneTopicCandidateArticle`/
 * `qualifiesForAutoGeneration`/`DEFAULT_AUTHOR` from it), never the reverse —
 * the same convention `@/lib/rankings/shared.ts` and `@/lib/synthesis/load.ts`
 * already use to avoid a module cycle, since `./index.ts` never needs
 * anything back from this file: callers (the scheduler, the manual
 * "Generate edition" route) import {@link processMissedDays} directly from
 * `@/lib/generation/daily`, not through `./index.ts`.
 */

import type { Article, Edition } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/config/settings";
import { getServiceToken, isServiceTokenExpired, upsertServiceToken } from "@/lib/service-token";
import { dayBounds } from "@/lib/cadence";
import { describeError, type FlashMessage } from "@/lib/flash";
import { editionMediaPrefix } from "@/lib/media-upload";
import { ARTICLE_ORDER } from "@/lib/editions";
import { generateEditionCoverImage } from "@/lib/ai/hero-image";
import {
  fetchAlexandriaActivity,
  fetchBlogActivity,
  fetchGithubActivity,
  fetchSpotifyActivity,
  refreshAccessToken,
  type ActivityItem,
} from "@/lib/sources";
import { computeGithubStats } from "@/lib/github-stats";
import {
  computeStarCandidates,
  computeTopicCandidates,
  mergeTopicCandidates,
  parseStoredTopicCandidates,
} from "@/lib/topic-candidates";
import { createActivityRankingArticle } from "@/lib/rankings";
import { createEditionSynthesisArticle } from "@/lib/synthesis";
import {
  dailyDispatchAgent,
  parseResponse,
  runNewspaperAgent,
  type ResolvedAiModel,
} from "@/mastra/agents";
import { summariseGroup } from "@/mastra/workflows";
import type { ActivityInput } from "@/mastra/schemas";
import type { GenerationProgress } from "./index";
import { DEFAULT_AUTHOR, generateOneTopicCandidateArticle, qualifiesForAutoGeneration } from "./index";

/** `Article.sourceType` for anything the machine wrote — mirrors `./index.ts`'s private `AI_SOURCE_TYPE`. */
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

// ---------------------------------------------------------------------------
// Progress reporting — same `Edition.generationStatus`/`generationProgress`
// columns and `/live` SSE route every other retry already rides, but with
// its own minimal begin/finish (not `./index.ts`'s private
// `beginSinglePieceRetry`/`finishSinglePieceRetry`): those assume a single
// thrown error is the only thing worth reporting, whereas a multi-day
// catch-up run accumulates its own list of non-fatal per-day warnings, more
// like `populateEditionDraft`'s own `messages` array than a single retry.
// ---------------------------------------------------------------------------

async function beginDailyProcessing(editionId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
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
        sourceProgress: { github: "pending", blog: "pending", spotify: "pending", alexandria: "pending" },
        totalSections: 1,
        completedSections: 0,
        sections: [{ category: "Daily analysis", status: "writing" }],
        messages: [],
      } satisfies GenerationProgress),
    },
  });
  return { ok: true };
}

async function finishDailyProcessing(editionId: number, messages: FlashMessage[]): Promise<void> {
  const notable = messages.filter((message) => message.type !== "success");
  await prisma.edition.update({
    where: { id: editionId },
    data: {
      generationStatus: "done",
      generationProgress:
        notable.length > 0
          ? JSON.stringify({
              sourceProgress: { github: "done", blog: "done", spotify: "done", alexandria: "done" },
              totalSections: 0,
              completedSections: 0,
              sections: [],
              messages: notable,
            } satisfies GenerationProgress)
          : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Per-day fetch — same four sources `populateEditionDraft` fetches, just a
// one-day range instead of the whole period, and non-fatal per-source like
// that function already is.
// ---------------------------------------------------------------------------

async function fetchDayActivity(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  messages: FlashMessage[],
): Promise<void> {
  const [githubToken, githubUsername] = await Promise.all([
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
  ]);
  if (githubToken && githubUsername) {
    try {
      const activities = await fetchGithubActivity({
        username: githubUsername,
        token: githubToken,
        periodStart: dayStart,
        periodEnd: dayEnd,
      });
      await saveActivities(editionId, activities);
    } catch (error) {
      messages.push({ type: "warning", text: `GitHub fetch warning: ${describeError(error)}` });
    }
  }

  const blogUrl = await getSetting("integrations.blog.rssUrl");
  if (blogUrl) {
    try {
      const activities = await fetchBlogActivity({ feedUrl: blogUrl, periodStart: dayStart, periodEnd: dayEnd });
      await saveActivities(editionId, activities);
    } catch (error) {
      messages.push({ type: "warning", text: `Blog fetch warning: ${describeError(error)}` });
    }
  }

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
      // `includeTopItems: false` — top tracks/artists have no timestamp and
      // are always Spotify's own trailing ~4-week snapshot regardless of
      // range, so fetching them once per day would insert the same
      // near-identical snapshot daily instead of once. See `fetchSpotifyActivity`'s
      // doc comment in `@/lib/sources/spotify.ts`.
      const items = await fetchSpotifyActivity({
        accessToken: spotifyToken!.accessToken,
        period: { periodStart: dayStart, periodEnd: dayEnd },
        includeTopItems: false,
      });
      await saveActivities(editionId, items);
    } catch (error) {
      messages.push({ type: "warning", text: `Spotify fetch warning: ${describeError(error)}` });
    }
  }

  const [alexandriaApiUrl, alexandriaApiToken] = await Promise.all([
    getSetting("integrations.alexandria.apiUrl"),
    getSetting("integrations.alexandria.apiToken", { encrypted: true }),
  ]);
  if (alexandriaApiUrl) {
    try {
      const activities = await fetchAlexandriaActivity({
        apiUrl: alexandriaApiUrl,
        apiToken: alexandriaApiToken,
        periodStart: dayStart,
        periodEnd: dayEnd,
      });
      await saveActivities(editionId, activities);
    } catch (error) {
      messages.push({ type: "warning", text: `Alexandria fetch warning: ${describeError(error)}` });
    }
  }
}

// ---------------------------------------------------------------------------
// The day's dispatch — replaces the old per-category monthly chronicle
// sections with one short piece per day. Direct `runNewspaperAgent()` call,
// no outline→sections workflow: a day's activity is already smaller than
// what a single chronicle category call handled before, which is the actual
// lesson `@/mastra/workflows/profile` proved fixes the self-hosted model's
// reasons-forever failure — no further decomposition needed here.
// ---------------------------------------------------------------------------

function buildDailyDispatchPrompt(dayLabel: string, activities: ActivityInput[]): string {
  return (
    `Write the daily dispatch for ${dayLabel}.\n\n` +
    `What happened:\n${summariseGroup(activities)}\n\n` +
    "Give the piece a compelling headline (as a markdown H1), then the body. " +
    "Do not include a byline or date — those are added separately."
  );
}

/** `null` when the day had no non-star activity — no LLM call, nothing written. */
async function writeDailyDispatch(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  dayLabel: string,
  aiModel: ResolvedAiModel | undefined,
): Promise<Article | null> {
  const rows = await prisma.serviceActivity.findMany({
    where: { editionId, timestamp: { gte: dayStart, lt: dayEnd }, eventType: { not: "star" } },
  });
  if (rows.length === 0) return null;

  const activityInputs: ActivityInput[] = rows.map((row) => ({
    eventType: row.eventType,
    repo: row.repo,
    title: row.title,
    url: row.url,
    timestamp: row.timestamp,
  }));

  const prompt = buildDailyDispatchPrompt(dayLabel, activityInputs);
  const raw = await runNewspaperAgent(dailyDispatchAgent, { user: prompt, aiModel });
  const { title, content } = parseResponse(raw, `Dispatch — ${dayLabel}`);

  return prisma.article.create({
    data: {
      editionId,
      title,
      content,
      category: "Dispatch",
      author: DEFAULT_AUTHOR,
      deck: deckFor(content),
      order: await nextArticleOrder(editionId),
      date: dayStart,
      sourceType: AI_SOURCE_TYPE,
      sourceData: JSON.stringify({
        generator: "daily-dispatch",
        prompt,
        response: raw,
        activity_count: rows.length,
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// One day, start to finish
// ---------------------------------------------------------------------------

async function processOneDay(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  isLastDay: boolean,
  aiModel: ResolvedAiModel | undefined,
  messages: FlashMessage[],
): Promise<void> {
  const dayLabel = dayStart.toISOString().slice(0, 10);

  await fetchDayActivity(editionId, dayStart, dayEnd, messages);

  // Recompute the GitHub stats bank cumulatively-to-date — `computeTopicCandidates`
  // reads it, and it already just filters by `editionId` with no date bound,
  // so re-running it daily against the growing row set needs no rework.
  try {
    const stats = await computeGithubStats(editionId);
    if (stats) {
      await prisma.edition.update({ where: { id: editionId }, data: { githubStats: JSON.stringify(stats) } });
    }
  } catch (error) {
    messages.push({ type: "warning", text: `GitHub stats warning (${dayLabel}): ${describeError(error)}` });
  }

  // Star + heuristic-detector candidates, merged (never overwritten) into
  // the edition's stored list — see `mergeTopicCandidates`'s doc comment for
  // why this is what makes daily recomputation safe. Diffed against what was
  // already there to find which ids are brand-new today.
  let newCandidateIds: string[] = [];
  try {
    const before = await prisma.edition.findUnique({ where: { id: editionId }, select: { topicCandidates: true } });
    const existing = parseStoredTopicCandidates(before?.topicCandidates);
    const [topicCandidates, starCandidates] = await Promise.all([
      computeTopicCandidates(editionId),
      computeStarCandidates(editionId, { since: dayStart }),
    ]);
    const fresh = [...(topicCandidates ?? []), ...starCandidates];
    if (fresh.length > 0) {
      const merged = mergeTopicCandidates(existing, fresh);
      await prisma.edition.update({ where: { id: editionId }, data: { topicCandidates: JSON.stringify(merged) } });
      const existingIds = new Set(existing.map((candidate) => candidate.id));
      newCandidateIds = fresh.filter((candidate) => !existingIds.has(candidate.id)).map((candidate) => candidate.id);
    }
  } catch (error) {
    messages.push({ type: "warning", text: `Topic candidate warning (${dayLabel}): ${describeError(error)}` });
  }

  if (aiModel) {
    try {
      await writeDailyDispatch(editionId, dayStart, dayEnd, dayLabel, aiModel);
    } catch (error) {
      messages.push({ type: "warning", text: `Daily dispatch warning (${dayLabel}): ${describeError(error)}` });
    }

    if (newCandidateIds.length > 0) {
      const after = await prisma.edition.findUnique({ where: { id: editionId }, select: { topicCandidates: true } });
      const all = parseStoredTopicCandidates(after?.topicCandidates);
      for (const id of newCandidateIds) {
        const candidate = all.find((c) => c.id === id);
        if (!candidate || !qualifiesForAutoGeneration(candidate)) continue;
        try {
          await generateOneTopicCandidateArticle(editionId, candidate, aiModel);
        } catch (error) {
          messages.push({
            type: "warning",
            text: `Topic candidate article warning ("${candidate.title}", ${dayLabel}): ${describeError(error)}`,
          });
        }
      }
    }
  }

  // --- Period end: the two things still done once, over everything
  // accumulated, rather than incrementally (see the plan's phase-2
  // non-goals for why the ranking isn't upserted daily yet). ---
  if (isLastDay && aiModel) {
    try {
      await createActivityRankingArticle(editionId, aiModel);
    } catch (error) {
      messages.push({ type: "warning", text: `Activity ranking warning: ${describeError(error)}` });
    }

    let generatedAnything = false;
    try {
      const synthesisArticle = await createEditionSynthesisArticle(editionId, aiModel);
      generatedAnything = Boolean(synthesisArticle);
    } catch (error) {
      messages.push({ type: "warning", text: `Edition synthesis warning: ${describeError(error)}` });
    }

    if (generatedAnything) {
      try {
        const edition = await prisma.edition.findUnique({ where: { id: editionId } });
        if (edition) {
          const articles = await prisma.article.findMany({
            where: { editionId },
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
            await prisma.edition.update({ where: { id: editionId }, data: { coverImage } });
          }
        }
      } catch (error) {
        messages.push({ type: "warning", text: `Edition cover image warning: ${describeError(error)}` });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ProcessMissedDaysResult {
  /** `YYYY-MM-DD` labels of every day actually processed this run, in order. */
  processedDays: string[];
  messages: FlashMessage[];
}

/**
 * Walk every calendar day from the edition's `lastProcessedDay` (exclusive)
 * — or `periodStart` if nothing has been processed yet — up to today or the
 * period's last day, whichever comes sooner. Sequential, not concurrent: a
 * later day's topic-candidate diff and cumulative stats need the previous
 * day's writes already committed. One bad day pushes warnings and moves on
 * — the same non-fatal-per-item pattern used throughout `./index.ts`.
 */
export async function processMissedDays(
  edition: Edition,
  aiModel: ResolvedAiModel | undefined,
): Promise<ProcessMissedDaysResult> {
  const begun = await beginDailyProcessing(edition.id);
  if (!begun.ok) {
    return { processedDays: [], messages: [{ type: "warning", text: begun.reason }] };
  }

  const messages: FlashMessage[] = [];
  const processedDays: string[] = [];

  try {
    const startDay = edition.lastProcessedDay
      ? dayBounds(new Date(edition.lastProcessedDay.getTime() + 86_400_000)).periodStart
      : dayBounds(edition.periodStart).periodStart;
    const today = dayBounds(new Date()).periodStart;
    const periodLastDay = dayBounds(new Date(edition.periodEnd.getTime() - 1)).periodStart;
    const lastDayToProcess = today.getTime() < periodLastDay.getTime() ? today : periodLastDay;

    let cursor = startDay;
    while (cursor.getTime() <= lastDayToProcess.getTime()) {
      const { periodStart: dayStart, periodEnd: dayEnd } = dayBounds(cursor);
      const dayLabel = dayStart.toISOString().slice(0, 10);
      const isLastDay = dayEnd.getTime() >= edition.periodEnd.getTime();

      try {
        await processOneDay(edition.id, dayStart, dayEnd, isLastDay, aiModel, messages);
        processedDays.push(dayLabel);
      } catch (error) {
        // processOneDay's own steps are all individually caught — reaching
        // here means something outside that (e.g. the lastProcessedDay
        // write itself) failed. Still advance the cursor rather than retry
        // the same day forever.
        messages.push({ type: "warning", text: `Day ${dayLabel} failed: ${describeError(error)}` });
      }

      await prisma.edition.update({ where: { id: edition.id }, data: { lastProcessedDay: dayStart } });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  } finally {
    await finishDailyProcessing(edition.id, messages);
  }

  return { processedDays, messages };
}
