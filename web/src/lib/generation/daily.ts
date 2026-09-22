/**
 * Daily-incremental edition generation — a job that processes one calendar
 * day at a time.
 *
 * **Current phase: stars-only, zero AI.** A day's processing is pure data:
 * fetch that day's GitHub activity, persist it, recompute the stats bank,
 * and surface star/topic candidates. No LLM call happens anywhere in
 * {@link processYesterdayIfNeeded}'s call path — the dispatch narrative
 * ({@link writeDailyDispatch}, still in this file), the per-star deep
 * profile (`generateOneTopicCandidateArticle`), the period-end activity
 * ranking / front-page synthesis (`createActivityRankingArticle` /
 * `createEditionSynthesisArticle`) and the cover-image step are all paused
 * for now, kept in the codebase rather than deleted (same "kept but unused"
 * precedent as `populateEditionDraft` in `./index.ts`). Re-enabling them is
 * a matter of calling them again from {@link processOneDay}; see the
 * "paused" comment at the end of that function.
 *
 * Likewise the blog/Spotify/Alexandria fetches: this path is GitHub-only
 * for now. `populateEditionDraft` in `./index.ts` still holds a working
 * four-source fetch to copy back from when they return.
 *
 * Every fetch range is one UTC calendar day, and a day's write owns its whole
 * range: {@link replaceDayActivities} clears `[dayStart, dayEnd)` before
 * inserting, so re-processing a day replaces it rather than doubling it. That
 * matters because one path deliberately never locks a day — the admin day
 * view's "process this day now" leaves `Edition.lastProcessedDay` alone on
 * purpose, so the same day can be requested any number of times.
 *
 * `Edition.lastProcessedDay` tracks how far automatic processing has
 * gotten — but, deliberately, a gap is never backfilled: this file's one
 * automatic entry point, {@link processYesterdayIfNeeded}, processes at most
 * the single most recently completed day and jumps `lastProcessedDay` straight
 * to it. A consequence worth knowing when reading that column: a day *below*
 * the cursor was not necessarily processed, so nothing may infer a day's
 * status from `day <= lastProcessedDay` alone (the admin day view's
 * `computeDayStatus` carries the full reasoning).
 *
 * Which edition a given day belongs to is its own question, answered by
 * {@link findEditionForDay} — see its doc comment for why "the edition for the
 * current period" is the wrong answer on a period's first day.
 *
 * One-way dependency on `./index.ts` (imports `DEFAULT_AUTHOR` from it),
 * never the reverse — the same convention `@/lib/rankings/shared.ts` and
 * `@/lib/synthesis/load.ts` already use to avoid a module cycle, since
 * `./index.ts` never needs anything back from this file: callers (the boot
 * check, the scheduler, the manual "Generate edition" route) import
 * {@link processYesterdayIfNeeded} directly from `@/lib/generation/daily`,
 * not through `./index.ts`.
 */

import type { Article, Edition } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/config/settings";
import { dayBounds } from "@/lib/cadence";
import { describeError, type FlashMessage } from "@/lib/flash";
import { fetchGithubActivity, type ActivityItem } from "@/lib/sources";
import { computeGithubStats } from "@/lib/github-stats";
import {
  computeStarCandidates,
  computeTopicCandidates,
  mergeTopicCandidates,
  parseStoredTopicCandidates,
} from "@/lib/topic-candidates";
import {
  dailyDispatchAgent,
  parseResponse,
  runNewspaperAgent,
  type ResolvedAiModel,
} from "@/mastra/agents";
import { summariseGroup } from "@/mastra/workflows";
import type { ActivityInput } from "@/mastra/schemas";
import type { GenerationProgress } from "./index";
import { DEFAULT_AUTHOR } from "./index";

/** `Article.sourceType` for anything the machine wrote — mirrors `./index.ts`'s private `AI_SOURCE_TYPE`. */
const AI_SOURCE_TYPE = "ai_generated";

/** `YYYY-MM-DD` for a UTC-midnight day — how every message in this file names a day. */
function dayLabelOf(dayStart: Date): string {
  return dayStart.toISOString().slice(0, 10);
}

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

function activityRows(editionId: number, items: ActivityItem[]) {
  return items.map((item) => ({
    editionId,
    source: item.source,
    eventType: item.eventType,
    repo: item.repo,
    title: item.title,
    url: item.url,
    timestamp: item.timestamp,
    rawJson: JSON.stringify(item.raw ?? {}),
  }));
}

/**
 * Make `items` the edition's complete set of `ServiceActivity` rows for
 * `[dayStart, dayEnd)` — existing rows in that range are deleted first, in
 * one transaction with the insert.
 *
 * This is what makes re-processing a day idempotent, which matters because
 * one entry point deliberately never locks a day against repeat runs: the
 * admin day view's "process this day now"
 * (`/admin/editions/[editionId]/day/[date]/process`) calls
 * {@link processOneDay} without advancing `Edition.lastProcessedDay`, so a
 * second click used to insert a second copy of that day's stars — inflating
 * `Edition.githubStats` counts and the day view's list with no cleanup path.
 * A plain `createMany` can't dedup here: `ServiceActivity` has no unique key
 * to collide on (see `prisma/schema.prisma`), and adding one would need a
 * migration, whereas delete-then-insert needs none and is the honest
 * semantic anyway — this call's fresh fetch is authoritative for its range.
 *
 * Rows with a `null` timestamp are never touched: they can't be attributed
 * to a calendar day, so no day's fetch owns them.
 *
 * Note this is only the *daily* path's writer. `./index.ts` keeps its own,
 * additive `saveActivities` for the whole-period `populateEditionDraft`
 * fetch, whose callers do rely on additive semantics across four sources.
 */
async function replaceDayActivities(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  items: ActivityItem[],
): Promise<void> {
  const rows = activityRows(editionId, items);
  await prisma.$transaction([
    prisma.serviceActivity.deleteMany({
      where: { editionId, timestamp: { gte: dayStart, lt: dayEnd } },
    }),
    ...(rows.length > 0 ? [prisma.serviceActivity.createMany({ data: rows })] : []),
  ]);
}

/** How many `ServiceActivity` rows this edition already has inside `[dayStart, dayEnd)`. */
async function countDayActivities(editionId: number, dayStart: Date, dayEnd: Date): Promise<number> {
  return prisma.serviceActivity.count({
    where: { editionId, timestamp: { gte: dayStart, lt: dayEnd } },
  });
}

// ---------------------------------------------------------------------------
// Progress reporting — same `Edition.generationStatus`/`generationProgress`
// columns and `/live` SSE route every other retry already rides, but with
// its own minimal begin/finish (not `./index.ts`'s private
// `beginSinglePieceRetry`/`finishSinglePieceRetry`): those assume a single
// thrown error is the only thing worth reporting, whereas a day's run
// accumulates its own list of non-fatal per-step warnings, more like
// `populateEditionDraft`'s own `messages` array than a single retry.
// ---------------------------------------------------------------------------

/**
 * Claim the edition's generation lock for a day's run, or report why not.
 *
 * A single conditional `updateMany` — never read-then-write. The two callers
 * of {@link processYesterdayIfNeeded} that can genuinely collide are the boot
 * check (`instrumentation.ts`) and the 4:00 UTC cron: a server started right
 * at the cron's fire time would, under a check-then-set, have both observe
 * "not running" and both proceed to process the same day twice. Guarding the
 * write on `generationStatus: { not: "running" }` and reading back `count`
 * makes exactly one of them the winner — `count === 0` means either another
 * process already holds the lock or the row is gone, which the follow-up
 * existence check tells apart.
 */
async function beginDailyProcessing(editionId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { count } = await prisma.edition.updateMany({
    where: { id: editionId, generationStatus: { not: "running" } },
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
  if (count > 0) return { ok: true };

  const exists = await prisma.edition.findUnique({ where: { id: editionId }, select: { id: true } });
  if (!exists) return { ok: false, reason: "Edition not found." };
  return {
    ok: false,
    reason: "Generation is already in progress for this edition — wait for it to finish, then retry.",
  };
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
// Per-day fetch — GitHub only, a one-day range instead of the whole period,
// and non-fatal like `populateEditionDraft`'s own per-source fetches are.
//
// The blog/Spotify/Alexandria fetchers are deliberately not called in this
// phase (stars-only). They are untouched in `@/lib/sources`, and
// `populateEditionDraft` (`./index.ts`) still holds a working four-source
// version to copy the per-source token/refresh handling back from when they
// return here.
// ---------------------------------------------------------------------------

async function fetchDayGithubActivity(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  messages: FlashMessage[],
): Promise<void> {
  const [githubToken, githubUsername] = await Promise.all([
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
  ]);
  if (!githubToken || !githubUsername) {
    messages.push({
      type: "warning",
      text: "GitHub isn't configured (token/username missing) — this day was recorded with no activity fetched.",
    });
    return;
  }

  try {
    // `fetchGithubActivity` degrades per event-type section rather than
    // throwing (see its doc comment), so "it returned" does not mean "it
    // returned everything". `onWarning` is what tells the two apart — without
    // it, a day whose star fetch failed looked exactly like a day with no
    // stars, and was silently recorded as such.
    const fetchWarnings: string[] = [];
    const activities = await fetchGithubActivity({
      username: githubUsername,
      token: githubToken,
      periodStart: dayStart,
      periodEnd: dayEnd,
      onWarning: (message) => fetchWarnings.push(message),
    });

    if (fetchWarnings.length === 0) {
      // Complete fetch: authoritative for this range, so replace it wholesale.
      await replaceDayActivities(editionId, dayStart, dayEnd, activities);
      return;
    }

    for (const warning of fetchWarnings) {
      messages.push({ type: "warning", text: `GitHub fetch warning (${dayLabelOf(dayStart)}): ${warning}` });
    }
    // An incomplete fetch is NOT authoritative, so it must not delete rows a
    // previous, complete run stored — a failing star endpoint would otherwise
    // wipe that day's stars. Writing it additively instead would duplicate
    // the sections that did succeed, so when the day already holds data the
    // safe move is to leave it exactly as it was and say so.
    const existing = await countDayActivities(editionId, dayStart, dayEnd);
    if (existing > 0) {
      messages.push({
        type: "warning",
        text: `Kept the ${existing} activity row(s) already stored for ${dayLabelOf(dayStart)} — the fetch above was incomplete, so it can't replace them. Re-run this day once GitHub responds fully.`,
      });
      return;
    }
    await replaceDayActivities(editionId, dayStart, dayEnd, activities);
  } catch (error) {
    messages.push({ type: "warning", text: `GitHub fetch warning: ${describeError(error)}` });
  }
}

// ---------------------------------------------------------------------------
// The day's dispatch — one short piece per day. Direct `runNewspaperAgent()`
// call, no outline→sections workflow: a day's activity is already smaller
// than what a single chronicle category call handled before, which is the
// actual lesson `@/mastra/workflows/profile` proved fixes the self-hosted
// model's reasons-forever failure — no further decomposition needed here.
//
// PAUSED THIS PHASE: nothing calls this right now (see this file's header).
// Kept intact and exported so re-enabling it later is one call from
// `processOneDay`, not a rewrite.
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
export async function writeDailyDispatch(
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
// One day, start to finish — stars-only, zero AI (see this file's header).
// ---------------------------------------------------------------------------

/**
 * Process a single UTC calendar day for an edition: fetch that day's GitHub
 * activity, persist it, recompute the cumulative stats bank, and merge any
 * newly-surfaced star/topic candidates into the edition. Pure data — no LLM
 * call anywhere in here.
 *
 * Every step is individually caught and degraded to a warning in
 * `messages`; the day still counts as processed. Does **not** advance
 * `Edition.lastProcessedDay` — its caller ({@link processYesterdayIfNeeded})
 * owns that, so this can also be re-run for an arbitrary past day (the admin
 * day view's "process this day now") without rewinding the edition's cursor.
 */
export async function processOneDay(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  messages: FlashMessage[],
): Promise<void> {
  const dayLabel = dayLabelOf(dayStart);

  await fetchDayGithubActivity(editionId, dayStart, dayEnd, messages);

  // Recompute the GitHub stats bank cumulatively-to-date — `computeTopicCandidates`
  // reads it, and it already just filters by `editionId` with no date bound,
  // so re-running it daily against the growing row set needs no rework.
  //
  // The write goes through `$transaction` because days now process
  // concurrently (see {@link claimDayProcessingRun}) and this is a
  // whole-JSON-column overwrite: SQLite serializes transactions, so two days
  // finishing at once queue instead of interleaving. `computeGithubStats`
  // stays outside it deliberately — it does a network language fetch, and
  // holding the write lock across that would trip Prisma's transaction
  // timeout.
  try {
    const stats = await computeGithubStats(editionId);
    if (stats) {
      await prisma.$transaction(async (tx) => {
        await tx.edition.update({ where: { id: editionId }, data: { githubStats: JSON.stringify(stats) } });
      });
    }
  } catch (error) {
    messages.push({ type: "warning", text: `GitHub stats warning (${dayLabel}): ${describeError(error)}` });
  }

  // Star + heuristic-detector candidates, merged (never overwritten) into
  // the edition's stored list — see `mergeTopicCandidates`'s doc comment for
  // why this is what makes daily recomputation safe. Both are pure scoring
  // over rows already in the database, no LLM involved. `computeTopicCandidates`
  // stays even though this phase only fetches GitHub: it scores the stats
  // bank, so with no blog/Spotify/Alexandria rows it simply finds less —
  // nothing to special-case, and it keeps the list ready for the AI phase.
  //
  // The read-merge-write is one `$transaction` — this is the genuine
  // lost-update hazard now that days run concurrently: two days each reading
  // the stored list, merging their own candidates into it and writing it back
  // would silently drop whichever wrote first. The scoring runs before the
  // transaction opens (it only reads `ServiceActivity`, and it is the slow
  // part) so the lock covers just the read-merge-write.
  try {
    const [topicCandidates, starCandidates] = await Promise.all([
      computeTopicCandidates(editionId),
      computeStarCandidates(editionId, { since: dayStart }),
    ]);
    const fresh = [...(topicCandidates ?? []), ...starCandidates];
    if (fresh.length > 0) {
      await prisma.$transaction(async (tx) => {
        const before = await tx.edition.findUnique({ where: { id: editionId }, select: { topicCandidates: true } });
        const merged = mergeTopicCandidates(parseStoredTopicCandidates(before?.topicCandidates), fresh);
        await tx.edition.update({ where: { id: editionId }, data: { topicCandidates: JSON.stringify(merged) } });
      });
    }
  } catch (error) {
    messages.push({ type: "warning", text: `Topic candidate warning (${dayLabel}): ${describeError(error)}` });
  }

  // PAUSED THIS PHASE — what used to run here, in order, all LLM-driven:
  //   1. `writeDailyDispatch(editionId, dayStart, dayEnd, dayLabel, aiModel)`
  //      — the day's multi-source narrative (still in this file).
  //   2. a per-candidate loop diffing the merge above for brand-new ids and
  //      calling `generateOneTopicCandidateArticle` (`./index.ts`) on each
  //      that `qualifiesForAutoGeneration` — the per-star deep profile.
  //   3. on the period's last day only: `createActivityRankingArticle`
  //      (`@/lib/rankings`), `createEditionSynthesisArticle`
  //      (`@/lib/synthesis`), and, if synthesis produced anything, the cover
  //      image via `generateEditionCoverImage` (`@/lib/ai/hero-image`).
  // All of those functions are untouched where they live; re-enabling is
  // calling them again from here (plus an `aiModel` parameter back on this
  // function and on `processYesterdayIfNeeded`). The last-day branch also
  // needs its `isLastDay` flag back — it was
  // `dayEnd >= edition.periodEnd` at the call site.
}

// ---------------------------------------------------------------------------
// Per-day run tracking — the record of an *attempt*, unlike `ServiceActivity`
// rows, which only record what an attempt found. Backs the fire-and-forget
// day-process route: the claim happens synchronously before the response, the
// work runs in `after()`.
// ---------------------------------------------------------------------------

/**
 * How long a `"running"` row is believed before it's treated as abandoned.
 * A day takes 15-30s; anything past this is a run whose process died (server
 * restart mid-`after()`), and blocking that day forever would be worse than
 * the rare double-run this risks.
 */
const STALE_RUN_MS = 10 * 60 * 1000;

/**
 * Claim this edition/day pair for processing, or report that it's already
 * running.
 *
 * Same never-read-then-write shape as {@link beginDailyProcessing}, scoped to
 * one day instead of the whole edition: a conditional `updateMany` reclaims
 * any row that isn't a live run (finished, failed, or stale), and `count`
 * names the winner when two requests arrive together. `count === 0` means
 * either no row exists yet — the `create` below — or a live run holds the
 * day, which the create's unique-constraint conflict tells apart.
 *
 * Different days claim different rows, so nothing here serializes across
 * days; only same-day double-clicks are rejected.
 */
export async function claimDayProcessingRun(
  editionId: number,
  date: Date,
): Promise<{ claimed: boolean; runId?: number }> {
  const { count } = await prisma.dayProcessingRun.updateMany({
    where: {
      editionId,
      date,
      OR: [{ status: { not: "running" } }, { startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } }],
    },
    data: { status: "running", startedAt: new Date(), finishedAt: null, error: null, hadActivity: null },
  });
  if (count > 0) {
    const reclaimed = await prisma.dayProcessingRun.findUnique({
      where: { editionId_date: { editionId, date } },
      select: { id: true },
    });
    if (reclaimed) return { claimed: true, runId: reclaimed.id };
  }

  try {
    const created = await prisma.dayProcessingRun.create({ data: { editionId, date, status: "running" } });
    return { claimed: true, runId: created.id };
  } catch (error) {
    // P2002 = the `(editionId, date)` unique index: a live run already owns
    // this day (the `updateMany` above declined to reclaim it).
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return { claimed: false };
    }
    throw error;
  }
}

/**
 * Run one day's processing and always settle its {@link claimDayProcessingRun}
 * row — the `after()` half of the day-process route.
 *
 * The `finally`-style settle is the point: a run that never writes `"done"` or
 * `"failed"` leaves the day showing `"processing"` forever, and the next click
 * can't reclaim it until the staleness window passes. Errors are logged and
 * swallowed rather than rethrown — nothing is listening (the response was sent
 * long ago), and the failure is already durable on the row.
 */
export async function runTrackedDayProcessing(
  editionId: number,
  dayStart: Date,
  dayEnd: Date,
  runId: number,
): Promise<void> {
  const messages: FlashMessage[] = [];
  try {
    await processOneDay(editionId, dayStart, dayEnd, messages);
    const hadActivity = (await countDayActivities(editionId, dayStart, dayEnd)) > 0;
    await prisma.dayProcessingRun.update({
      where: { id: runId },
      data: { status: "done", finishedAt: new Date(), hadActivity },
    });
  } catch (error) {
    console.error(`Day processing failed (edition ${editionId}, ${dayLabelOf(dayStart)}):`, error);
    await prisma.dayProcessingRun.update({
      where: { id: runId },
      data: { status: "failed", finishedAt: new Date(), error: describeError(error) },
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ProcessYesterdayResult {
  /** True when a day was actually processed this call (false = already caught up / nothing due). */
  processed: boolean;
  /** UTC midnight of the day processed, or `null` when nothing was. */
  day: Date | null;
  messages: FlashMessage[];
}

/**
 * Process the single most recently completed day ("yesterday") for this
 * edition, if it hasn't been processed already.
 *
 * Deliberately **no backfill**: when `lastProcessedDay` is `null` or days
 * behind (server down for a week, this feature shipping mid-month), the
 * earlier days are abandoned, not walked — `lastProcessedDay` jumps
 * straight to yesterday. That is the whole point of this entry point
 * replacing the old multi-day catch-up loop; a day without a page stays
 * without a page.
 *
 * The day is clamped to the edition's own period on both ends: never past
 * `periodEnd` (a finished edition processes its last day at most), and
 * never before `periodStart` (on the 1st of a month, yesterday belongs to
 * the *previous* edition, so the new one has nothing due yet).
 */
/**
 * The day {@link processYesterdayIfNeeded} would process for this edition
 * right now, or `null` when nothing is due (already caught up, or the
 * edition's period hasn't reached a completed day yet).
 *
 * Pure — no queries, no writes. Split out so a caller can word its UI for the
 * actual outcome *before* kicking the work off in the background (the manual
 * "Generate edition" route does exactly that) without duplicating the clamp
 * and cursor rules that decide it.
 */
export function dueDayFor(edition: Edition): Date | null {
  const today = dayBounds(new Date()).periodStart;
  const yesterday = new Date(today.getTime() - 86_400_000);
  const periodFirstDay = dayBounds(edition.periodStart).periodStart;
  const periodLastDay = dayBounds(new Date(edition.periodEnd.getTime() - 1)).periodStart;
  const target = yesterday.getTime() > periodLastDay.getTime() ? periodLastDay : yesterday;

  if (target.getTime() < periodFirstDay.getTime()) return null;
  const lastProcessed = edition.lastProcessedDay ? dayBounds(edition.lastProcessedDay).periodStart : null;
  if (lastProcessed && lastProcessed.getTime() >= target.getTime()) return null;
  return target;
}

export async function processYesterdayIfNeeded(edition: Edition): Promise<ProcessYesterdayResult> {
  const target = dueDayFor(edition);
  if (target === null) {
    return { processed: false, day: null, messages: [] };
  }

  const begun = await beginDailyProcessing(edition.id);
  if (!begun.ok) {
    return { processed: false, day: null, messages: [{ type: "warning", text: begun.reason }] };
  }

  const messages: FlashMessage[] = [];
  const { periodStart: dayStart, periodEnd: dayEnd } = dayBounds(target);
  const dayLabel = dayLabelOf(dayStart);

  try {
    try {
      await processOneDay(edition.id, dayStart, dayEnd, messages);
    } catch (error) {
      // `processOneDay`'s own steps are all individually caught — reaching
      // here means something outside them threw. The day still counts as
      // processed rather than being retried forever.
      messages.push({ type: "warning", text: `Day ${dayLabel} failed: ${describeError(error)}` });
    }
    await prisma.edition.update({ where: { id: edition.id }, data: { lastProcessedDay: dayStart } });
  } finally {
    await finishDailyProcessing(edition.id, messages);
  }

  return { processed: true, day: dayStart, messages };
}

/** UTC midnight of the most recently completed calendar day. */
export function yesterdayUtc(): Date {
  return new Date(dayBounds(new Date()).periodStart.getTime() - 86_400_000);
}

/**
 * The `Edition` whose `[periodStart, periodEnd)` actually contains `day`, or
 * `null` if no edition covers it.
 *
 * Both of {@link processYesterdayIfNeeded}'s automatic callers need this, and
 * for the same reason: each used to look up only "the edition for the period
 * containing *today*" and hand that to `processYesterdayIfNeeded`. On the
 * first day of a period that edition is the wrong one — yesterday falls before
 * its `periodStart`, so the (correct, deliberate) `periodStart` clamp made the
 * call a no-op, and nothing ever handed the *outgoing* edition its own last
 * day. Every period silently lost its final calendar day (under weekly
 * cadence, every Sunday).
 *
 * Matched on the stored range rather than by recomputing bounds from the
 * current `cadence` setting (`periodBoundsForDate`), so a cadence changed
 * since the outgoing edition was created still routes that edition's own last
 * day to it. `periodStart desc` picks the newest on the theoretically-possible
 * overlap of a weekly and a monthly edition covering the same day.
 */
export async function findEditionForDay(day: Date): Promise<Edition | null> {
  const dayStart = dayBounds(day).periodStart;
  return prisma.edition.findFirst({
    where: { periodStart: { lte: dayStart }, periodEnd: { gt: dayStart } },
    orderBy: { periodStart: "desc" },
  });
}
