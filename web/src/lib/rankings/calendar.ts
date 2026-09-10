/**
 * Calendar stats ranking — Phase F of the google-calendar-alexandria-sources
 * plan, sibling to `./activity.ts`'s GitHub activity ranking (same overall
 * shape: a pure-TypeScript computation, one `chronicleAgent`/
 * `runNewspaperAgent` LLM call, persistence via `persistRankingArticle`).
 *
 * **Privacy is structural, not just a UI filter.** This module never imports
 * anything from `@/lib/sources/google.ts` except {@link fetchCalendarEventStats}
 * and its {@link CalendarEventTiming} return type — a type with exactly two
 * fields, `start` and `end`. There is no field on that type to hold an event
 * title or description, so `computeCalendarRanking` and the narration prompt
 * built from its output are structurally incapable of leaking event content,
 * regardless of how the narration prompt is later edited. See
 * `fetchCalendarEventStats`'s own doc comment for the second half of the
 * guarantee: the Calendar API request itself restricts the response to
 * `items(start,end)`, so title/description are never even transmitted over
 * the wire for a Stats-only calendar.
 *
 * {@link createCalendarRankingArticle} is the entry point: it returns `null`
 * (not an error) when Google Calendar isn't connected, no calendar is in
 * "stats"/"both" mode, or those calendars have zero events for the period —
 * matching the plan's "skip gracefully" requirement for the automatic
 * pipeline. A single calendar's fetch failing (revoked access, deleted
 * calendar, etc.) is logged and skipped, never failing the whole ranking —
 * the same per-source graceful-degradation pattern `runEditionGeneration`
 * already established.
 */

import type { Article } from "@/generated/prisma/client";
import { periodLabel } from "@/lib/edition-helpers";
import { prisma } from "@/lib/prisma";
import { type CalendarEventTiming, fetchCalendarEventStats, getValidGoogleAccessToken } from "@/lib/sources/google";
import {
  chronicleAgent,
  MODEL_NAME,
  parseResponse,
  runNewspaperAgent,
  type ResolvedAiModel,
} from "@/mastra/agents";
import type { GeneratorResult } from "@/mastra/schemas";
import { RANKING_CATEGORY, persistRankingArticle } from "./shared";

/** Calendars whose events are ever read for this ranking. */
const STATS_MODES = ["stats", "both"];

export interface CalendarDayCount {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  count: number;
}

export interface DayOfWeekCount {
  /** "Sunday" .. "Saturday". */
  day: string;
  count: number;
}

export interface CalendarRankingComputation {
  totalEvents: number;
  /** Sum of every event's duration, in hours, rounded to one decimal place. */
  totalHours: number;
  /** Every day with at least one event, sorted busiest-first (date ascending on ties). */
  dayCounts: CalendarDayCount[];
  /** The subset of `dayCounts` tied at the maximum count — "busiest day(s)". */
  busiestDays: CalendarDayCount[];
  /** Sunday-first, one entry per day of the week. */
  dayOfWeekDistribution: DayOfWeekCount[];
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** `YYYY-MM-DD` in UTC, matching `./activity.ts`'s convention. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Bucket a period's calendar event timings into busiest-day, total-hours, and
 * day-of-week breakdowns. Pure function, no I/O — `timings` carries only
 * `start`/`end`, never event content (see the module doc comment).
 */
export function computeCalendarRanking(timings: CalendarEventTiming[]): CalendarRankingComputation {
  const dayMap = new Map<string, number>();
  const dowCounts = new Array<number>(7).fill(0);
  let totalMs = 0;

  for (const { start, end } of timings) {
    totalMs += Math.max(0, end.getTime() - start.getTime());
    dayMap.set(dayKey(start), (dayMap.get(dayKey(start)) ?? 0) + 1);
    dowCounts[start.getUTCDay()] += 1;
  }

  const dayCounts = [...dayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
  const maxCount = dayCounts[0]?.count ?? 0;
  const busiestDays = dayCounts.filter((d) => d.count === maxCount && maxCount > 0);

  const dayOfWeekDistribution = DAY_NAMES.map((day, index) => ({ day, count: dowCounts[index] }));

  return {
    totalEvents: timings.length,
    totalHours: Math.round((totalMs / 3_600_000) * 10) / 10,
    dayCounts,
    busiestDays,
    dayOfWeekDistribution,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch and merge event timings from every "stats"/"both" calendar for
 * `[periodStart, periodEnd)`. Returns an empty array (not an error) when
 * Google Calendar isn't connected or no calendar is opted into stats — the
 * caller treats that as "nothing to rank."
 */
async function fetchStatsTimings(periodStart: Date, periodEnd: Date): Promise<CalendarEventTiming[]> {
  const calendars = await prisma.calendarSource.findMany({
    where: { mode: { in: STATS_MODES } },
    select: { googleCalendarId: true },
  });
  if (calendars.length === 0) return [];

  const accessToken = await getValidGoogleAccessToken();
  if (!accessToken) return [];

  const timings: CalendarEventTiming[] = [];
  for (const calendar of calendars) {
    try {
      const events = await fetchCalendarEventStats(accessToken, calendar.googleCalendarId, periodStart, periodEnd);
      timings.push(...events);
    } catch (error) {
      console.error(
        `[rankings] Calendar stats fetch failed for ${calendar.googleCalendarId}: ${describe(error)}`,
      );
    }
  }
  return timings;
}

function buildCalendarRankingPrompt(label: string, computation: CalendarRankingComputation): string {
  const busiest = computation.busiestDays.map((d) => `${d.date} (${d.count} events)`).join(", ");
  const dowLine = computation.dayOfWeekDistribution
    .filter((d) => d.count > 0)
    .map((d) => `${d.day}: ${d.count}`)
    .join(", ");

  return (
    `Write a newspaper article for the 'Rankings' section of the ${label} edition ` +
    `of ¡Albricias!, a calendar & scheduling almanac reporting only aggregate ` +
    `numbers about the correspondent's meetings and appointments this period — ` +
    `no meeting titles, topics, or attendees are available or should be invented.\n\n` +
    `Report on the total number of events, the total hours spent in scheduled ` +
    `time, the busiest day(s), and the balance of activity across the days of ` +
    `the week, as a droll almanac of a life ruled by the calendar — think a ` +
    `vintage newspaper's statistics column, part boast, part diary.\n\n` +
    `Data:\n` +
    `- Total events: ${computation.totalEvents}\n` +
    `- Total hours scheduled: ${computation.totalHours}\n` +
    `- Busiest day(s): ${busiest || "none recorded"}\n` +
    `- Day-of-week distribution: ${dowLine || "none"}\n\n` +
    `Give the article a compelling headline (as a markdown H1), then the body text. ` +
    `Do not include a byline or date — those are added separately. Do not fabricate ` +
    `numbers, meeting names, or topics beyond the aggregate data given above.`
  );
}

export interface CalendarRankingInput {
  periodLabel: string;
  computation: CalendarRankingComputation;
}

/** One LLM call, in the `NEWSPAPER_PERSONA` voice, narrating the raw calendar numbers. */
export async function narrateCalendarRanking(
  input: CalendarRankingInput,
  aiModel?: ResolvedAiModel,
): Promise<GeneratorResult> {
  const prompt = buildCalendarRankingPrompt(input.periodLabel, input.computation);
  const raw = await runNewspaperAgent(chronicleAgent, { user: prompt, aiModel });
  const { title, content } = parseResponse(raw, `Calendar Almanac — ${input.periodLabel}`);
  return {
    title,
    content,
    category: RANKING_CATEGORY,
    sourceData: {
      generator: "calendar-ranking",
      prompt,
      response: raw,
      model: MODEL_NAME,
      computation: input.computation,
    },
  };
}

/**
 * Compute and narrate the calendar ranking for `editionId`, persisting it as
 * an `Article`. Returns `null` — not an error — when there is nothing to
 * rank (Google Calendar not connected, no calendar in "stats"/"both" mode, or
 * zero events across those calendars for the period), so callers (the
 * automatic pipeline) can skip gracefully with no article.
 */
export async function createCalendarRankingArticle(
  editionId: number,
  aiModel?: ResolvedAiModel,
): Promise<Article | null> {
  const edition = await prisma.edition.findUnique({ where: { id: editionId } });
  if (!edition) throw new Error(`Edition ${editionId} not found.`);

  const timings = await fetchStatsTimings(edition.periodStart, edition.periodEnd);
  if (timings.length === 0) return null;

  const computation = computeCalendarRanking(timings);
  const label = periodLabel(edition);
  const result = await narrateCalendarRanking({ periodLabel: label, computation }, aiModel);
  return persistRankingArticle(editionId, result, edition.periodStart);
}
