/**
 * Day-post workflow — research → outline → per-section drafts → assemble.
 *
 * The same shape, and for the same reason, as `./profile.ts`: several small,
 * tightly-scoped model calls instead of one big "write today's post" request,
 * because the self-hosted model behind this app's LiteLLM proxy reasons forever
 * on a long demanding prompt and returns empty text (that file's header carries
 * the full history). This workflow is that file's day-scoped sibling and is
 * deliberately read alongside it — where a decision here has no comment, it is
 * because `profile.ts` already argues it.
 *
 * Shape:
 *   research-day  →  build-day-outline  →  foreach(write-day-section, { concurrency: DAY_SECTION_CONCURRENCY })  →  assemble-day-post
 *
 * Three differences from the profile pipeline, all following from "a day is
 * small":
 *
 *   1. `research-day` reads the **database**, not the network — the day's
 *      `ServiceActivity` rows, the `Repo` facts a starred repo was already
 *      enriched with by `enrichStarredRepos`, and this paper's own earlier
 *      coverage via `ArticleRepoMention`. Everything it needs was fetched by
 *      day processing hours earlier, so there is nothing to re-fetch and no
 *      network failure mode to degrade around.
 *   2. There is no `write-data-section`. A day's numbers are its activity
 *      counts, and those are already in every section's source material;
 *      a separate charted section over a single day's figures would be
 *      padding, which is this workflow's main failure mode rather than
 *      shallowness.
 *   3. `assemble-day-post` **persists** the `Article` itself (and its
 *      `ArticleRepoMention` rows) rather than returning a `GeneratorResult`
 *      for a caller to write, because the day's post is keyed —
 *      `(editionId, dayDate)` is unique — and the upsert against that key is
 *      what makes re-generating a day replace its post instead of adding a
 *      second one.
 *
 * The `GenerationTrace` it records is the *same* object `assemble-article`
 * builds (`@/mastra/schemas`' `generationTraceSchema`), which is what lets
 * `GenerationTraceGraph` render a day's post with no changes at all.
 *
 * A day with no recorded activity is not a day this workflow can write about,
 * and `research-day` throws rather than inventing one — callers are expected to
 * check for activity before starting a run (`DayProcessingRun.hadActivity`
 * already answers exactly that question).
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { dayBounds } from "@/lib/cadence";
import { computeDayTrend, type DaySummary, type DayTrend } from "@/lib/generation/day-trend";
import { prisma } from "@/lib/prisma";

import { MODEL_NAME, dayPostOutlineAgent, dayPostSectionAgent, runNewspaperAgent } from "../agents";
import { stripLeadingHeadingLine } from "../agents/base";
import type { ActivityInput } from "../schemas";
import { type GenerationTrace, generationTraceSchema, resolvedAiModelSchema } from "../schemas";
import { summariseGroup } from "./chronicle";
import { assembleProfileContent, parseOutline } from "./profile";

/** Same rationale as `PROFILE_SECTION_CONCURRENCY` (`./profile.ts:82`): the self-hosted model drops proxy connections under concurrent load. */
export const DAY_SECTION_CONCURRENCY = 1;

/** How many days back the activity trend compares against, when that much history exists. */
export const DAY_TREND_WINDOW_DAYS = 14;

/**
 * By-line stamped on the post. The same string as `DEFAULT_AUTHOR`
 * (`@/lib/generation`), declared here rather than imported because that module
 * imports this one's barrel — importing it back would close a module cycle.
 */
const DAY_POST_AUTHOR = "The Albricias Correspondent";

/** `Article.sourceType` for anything the machine wrote — mirrors `@/lib/generation`'s private `AI_SOURCE_TYPE`. */
const AI_SOURCE_TYPE = "ai_generated";

/** Where a day's post files. Matches `writeDailyDispatch`'s category (`@/lib/generation/daily`). */
const DAY_POST_CATEGORY = "Dispatch";

const dayPostInputSchema = z.object({
  editionId: z.number().int(),
  /** The UTC calendar day to write about, as `YYYY-MM-DD`. */
  day: z.string(),
  aiModel: resolvedAiModelSchema.optional(),
  trendWindowDays: z.number().int().default(DAY_TREND_WINDOW_DAYS),
});
export type DayPostWorkflowInput = z.input<typeof dayPostInputSchema>;

/** What every later step needs from `research-day`, echoed through the `foreach` the same way `outlineTrace` is. */
const dayContextSchema = z.object({
  editionId: z.number().int(),
  day: z.string(),
  /** Every distinct repository the day touched, `"owner/name"` — the set a section's `SOURCE:` line is matched against. */
  repos: z.array(z.string()),
  activityCount: z.number().int(),
  /** ISO, when `research-day` began — the trace's own `startedAt`. */
  startedAt: z.string(),
});

const dayResearchOutputSchema = dayPostInputSchema.extend({
  /** The labeled source blocks every prompt in this workflow is built over. */
  sourceText: z.string(),
  context: dayContextSchema,
});

const outlineTraceSchema = z.object({
  prompt: z.string(),
  response: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
});

const daySectionJobSchema = z.object({
  index: z.number().int(),
  heading: z.string(),
  brief: z.string(),
  /** The repository this section is about, or `""` — resolved from the outline's `SOURCE:` line. */
  repo: z.string(),
  sourceText: z.string(),
  premise: z.string(),
  title: z.string(),
  aiModel: resolvedAiModelSchema.optional(),
  outlineTrace: outlineTraceSchema,
  context: dayContextSchema,
});

const daySectionOutcomeSchema = daySectionJobSchema.extend({
  ok: z.boolean(),
  markdown: z.string().nullable(),
  prompt: z.string(),
  response: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  error: z.string().nullable(),
});

/** What the workflow hands back — the row it wrote, not the article text, which is on that row. */
export const dayPostResultSchema = z.object({
  articleId: z.number().int(),
  title: z.string(),
  status: z.enum(["success", "partial", "failed"]),
  sectionCount: z.number().int(),
  /** The `ArticleRepoMention` rows written, `"owner/name"` each. */
  repoMentions: z.array(z.string()),
});
export type DayPostResult = z.infer<typeof dayPostResultSchema>;

// ---------------------------------------------------------------------------
// Research: rendering the day's stored rows as labeled source blocks
// ---------------------------------------------------------------------------

/** `"2026-09-22"` → its UTC day bounds. */
function boundsForDay(day: string): { dayStart: Date; dayEnd: Date } {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a YYYY-MM-DD day: "${day}"`);
  const { periodStart, periodEnd } = dayBounds(parsed);
  return { dayStart: periodStart, dayEnd: periodEnd };
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `{ commit: 7, star: 2 }` → `"7 commit, 2 star"`, busiest kind first. */
function countByEventType(rows: { eventType: string }[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.eventType, (counts.get(row.eventType) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
}

/** A stored JSON-string column, or `null` for anything unreadable — a hand-edited row must not fail a whole run. */
function parseJson<T>(stored: string | null): T | null {
  if (!stored) return null;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
}

/**
 * One enriched `Repo` row as a compact plain-text line, the same
 * one-line-of-facts convention `renderRepoFactsText` (`./profile.ts`) uses for
 * a freshly fetched bundle.
 *
 * Only what was actually stored is mentioned. A row whose enrichment failed
 * carries `enrichError` and null counts, and saying so is the honest rendering
 * — narrating its nulls as "0 stars" is exactly the fabrication
 * `fetchRepoFacts`' `metadataOk` flag exists to prevent upstream.
 */
function renderRepoRow(repo: {
  fullName: string;
  description: string | null;
  stargazersCount: number | null;
  forksCount: number | null;
  license: string | null;
  topics: string | null;
  languages: string | null;
  latestRelease: string | null;
  enrichError: string | null;
}): string {
  const parts: string[] = [];
  if (repo.description) parts.push(repo.description);
  if (repo.stargazersCount !== null) parts.push(`Stars: ${repo.stargazersCount.toLocaleString("en-US")}`);
  if (repo.forksCount !== null) parts.push(`Forks: ${repo.forksCount.toLocaleString("en-US")}`);
  if (repo.license) parts.push(`License: ${repo.license}`);

  const languages = parseJson<{ name: string; pct: number }[]>(repo.languages);
  if (languages && languages.length > 0) {
    parts.push(`Languages: ${languages.map((lang) => `${lang.name} (${lang.pct}%)`).join(", ")}`);
  }
  const topics = parseJson<string[]>(repo.topics);
  if (topics && topics.length > 0) parts.push(`Topics: ${topics.join(", ")}`);

  const release = parseJson<{ latestTag: string | null; latestDate: string | null }>(repo.latestRelease);
  if (release?.latestTag) {
    parts.push(`Latest release: ${release.latestTag}${release.latestDate ? ` (${release.latestDate.slice(0, 10)})` : ""}`);
  }
  if (parts.length === 0) {
    parts.push(repo.enrichError ? `No stored facts — enrichment failed: ${repo.enrichError}` : "No stored facts.");
  }
  return `- ${repo.fullName} — ${parts.join(" · ")}`;
}

/** The `## Activity trend` block, or `""` when there is no history to compare against (never a fabricated comparison). */
export function renderDayTrendText(trend: DayTrend | null, current: DaySummary): string {
  if (!trend) return "";
  const { vsPreviousDay, vsRecentAverage, consecutiveActiveDays } = trend;
  const pct = (value: number | null) => (value === null ? "" : ` (${value > 0 ? "+" : ""}${value}%)`);
  return [
    `Today: ${current.totalEvents} events across ${current.distinctRepos} repositories.`,
    `Previous recorded day (${vsPreviousDay.previousDate.slice(0, 10)}): ${vsPreviousDay.referenceEvents} events — ${vsPreviousDay.direction}${vsPreviousDay.direction === "flat" ? "" : ` by ${Math.abs(vsPreviousDay.deltaEvents)}`}${pct(vsPreviousDay.deltaPercent)}.`,
    `Average over the ${vsRecentAverage.days} recorded day(s) before today: ${vsRecentAverage.averageEvents} events — today is ${vsRecentAverage.direction}${vsRecentAverage.direction === "flat" ? "" : ` by ${Math.abs(vsRecentAverage.deltaEvents)}`}${pct(vsRecentAverage.deltaPercent)}.`,
    `Days with activity in a row, including today: ${consecutiveActiveDays}.`,
  ].join("\n");
}

/** Assemble the labeled blocks. The headings are the exact ones `DAY_POST_OUTLINE_SYSTEM` names. */
function buildDaySourceText(blocks: {
  activity: string;
  repoFacts: string;
  priorCoverage: string;
  trend: string;
}): string {
  return [
    `## Today's activity\n\n${blocks.activity}`,
    blocks.repoFacts ? `## Repository facts\n\n${blocks.repoFacts}` : "",
    blocks.priorCoverage ? `## Previously covered\n\n${blocks.priorCoverage}` : "",
    blocks.trend ? `## Activity trend\n\n${blocks.trend}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function buildDayOutlinePrompt(input: { day: string; sourceText: string }): string {
  return `The day being covered is ${input.day}.\n\nMaterial:\n${input.sourceText}\n`;
}

export function buildDaySectionPrompt(input: {
  day: string;
  heading: string;
  brief: string;
  premise: string;
  sourceText: string;
}): string {
  return (
    `The day being covered is ${input.day}.\n\n` +
    `The post's overall premise: ${input.premise}\n\n` +
    `Write the section titled "${input.heading}". ${input.brief}\n\n` +
    `The day's material:\n${input.sourceText}\n`
  );
}

/**
 * Which repository an outline section is about, from its `SOURCE:` line — `""`
 * when it names a block heading (`Activity trend`) instead of a repo, which is
 * a section about the day as a whole rather than about any one project.
 */
export function matchSectionRepo(sourceRef: string, repos: string[]): string {
  const needle = sourceRef.trim().toLowerCase();
  if (!needle) return "";
  return repos.find((repo) => needle.includes(repo.toLowerCase())) ?? "";
}

/**
 * The repositories a finished post actually talks about — what
 * `ArticleRepoMention` rows are written from, and therefore what a *later*
 * day's `research-day` will find as prior coverage.
 *
 * A section's outline tag counts only when that section was actually written
 * (a failed one talks about nothing), and any repository named outright in the
 * assembled prose counts too — the outline plans a section per repository, but
 * a section about one project routinely names another in passing, and that is
 * still coverage. Matched on the full `"owner/name"` rather than the bare
 * name, which would claim every mention of a common word as a repository.
 */
export function collectRepoMentions(
  sections: { repo: string; ok: boolean }[],
  content: string,
  dayRepos: string[],
): string[] {
  const mentioned = new Set(sections.filter((section) => section.ok && section.repo).map((s) => s.repo));
  const haystack = content.toLowerCase();
  for (const repo of dayRepos) {
    if (haystack.includes(repo.toLowerCase())) mentioned.add(repo);
  }
  return [...mentioned].sort();
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * No LLM call, and no network call either — every query below reads rows this
 * day's processing already wrote (see this file's header).
 */
const researchDayStep = createStep({
  id: "research-day",
  description:
    "Gather everything already stored about the day — its activity rows, its starred repos' facts, this paper's earlier coverage of those repos, and the day's activity trend — as labeled source blocks.",
  inputSchema: dayPostInputSchema,
  outputSchema: dayResearchOutputSchema,
  execute: async ({ inputData }) => {
    const startedAt = new Date().toISOString();
    const { editionId, day } = inputData;
    const { dayStart, dayEnd } = boundsForDay(day);

    const rows = await prisma.serviceActivity.findMany({
      where: { editionId, timestamp: { gte: dayStart, lt: dayEnd } },
      orderBy: { timestamp: "asc" },
    });
    if (rows.length === 0) {
      throw new Error(`No activity recorded for ${day} — there is no day post to write.`);
    }

    const repos = [...new Set(rows.map((row) => row.repo).filter((repo): repo is string => Boolean(repo)))];
    const activityInputs: ActivityInput[] = rows.map((row) => ({
      eventType: row.eventType,
      repo: row.repo,
      title: row.title,
      url: row.url,
      timestamp: row.timestamp,
    }));

    // Facts for the day's *starred* repos only: those are the ones
    // `enrichStarredRepos` (`@/lib/generation/daily`) keeps a `Repo` row
    // current for, so asking for the others would return stale rows or none.
    const starred = [
      ...new Set(
        rows
          .filter((row) => row.eventType === "star")
          .map((row) => row.repo)
          .filter((repo): repo is string => Boolean(repo)),
      ),
    ];
    const repoRows =
      starred.length > 0
        ? await prisma.repo.findMany({ where: { fullName: { in: starred } } })
        : [];

    // Earlier day-posts that named any of today's repos — the whole reason
    // `ArticleRepoMention` exists, and an indexed lookup rather than a scan of
    // prior articles' markdown. Only strictly-earlier days count: re-generating
    // today's post must not report today's own previous attempt as history.
    const priorMentions =
      repos.length > 0
        ? await prisma.articleRepoMention.findMany({
            where: { repoFullName: { in: repos }, article: { dayDate: { lt: dayStart } } },
            select: { repoFullName: true, article: { select: { title: true, dayDate: true } } },
            orderBy: { article: { dayDate: "asc" } },
          })
        : [];

    // Trend window. Scoped to this edition deliberately: a weekly and a monthly
    // edition may both cover the same calendar day (see `findEditionForDay`),
    // and counting a day twice would invent activity. The cost is a shorter
    // window at the start of a period, which `computeDayTrend` reports honestly
    // as fewer days compared rather than as a quiet stretch.
    const windowStart = new Date(dayStart.getTime() - inputData.trendWindowDays * 86_400_000);
    const [windowRows, priorRuns] = await Promise.all([
      prisma.serviceActivity.findMany({
        where: { editionId, timestamp: { gte: windowStart, lt: dayStart } },
        select: { timestamp: true, repo: true },
      }),
      prisma.dayProcessingRun.findMany({
        where: { editionId, date: { gte: windowStart, lt: dayStart }, status: "done" },
        select: { date: true },
      }),
    ]);
    const trend = computeDayTrend(
      { date: dayStart.toISOString(), totalEvents: rows.length, distinctRepos: repos.length },
      summariseWindow(windowRows, priorRuns),
    );

    // The header's counts are computed over *every* row; `summariseGroup` lists
    // at most its own `MAX_ACTIVITIES_PER_GROUP`. That is the right way round —
    // an exceptionally busy day gets a trimmed list under an honest total,
    // rather than a model inferring the day's size from the list's length.
    const header =
      `Date: ${day}\n` +
      `${rows.length} recorded events across ${repos.length} repositories: ${countByEventType(rows)}.`;

    return {
      ...inputData,
      sourceText: buildDaySourceText({
        activity: `${header}\n\n${summariseGroup(activityInputs)}`,
        repoFacts: repoRows.map(renderRepoRow).join("\n"),
        priorCoverage: priorMentions
          .map(
            (mention) =>
              `- ${mention.repoFullName} — covered on ${mention.article.dayDate ? utcDayKey(mention.article.dayDate) : "an earlier day"} in "${mention.article.title}".`,
          )
          .join("\n"),
        trend: renderDayTrendText(trend, {
          date: dayStart.toISOString(),
          totalEvents: rows.length,
          distinctRepos: repos.length,
        }),
      }),
      context: { editionId, day, repos, activityCount: rows.length, startedAt },
    };
  },
});

/**
 * The window's rows and processed-but-empty days as one `DaySummary` per day
 * the app actually knows something about.
 *
 * A day with no row *and* no finished run is left out entirely rather than
 * recorded as zero: nothing was ever observed about it, and passing it in as a
 * quiet day would fabricate the quiet (and break an activity run that never
 * actually broke). `computeDayTrend` treats an absent day and a zero day
 * differently for exactly that reason.
 */
function summariseWindow(
  rows: { timestamp: Date | null; repo: string | null }[],
  runs: { date: Date }[],
): DaySummary[] {
  const byDay = new Map<string, { events: number; repos: Set<string> }>();
  const ensure = (key: string) => {
    const existing = byDay.get(key);
    if (existing) return existing;
    const fresh = { events: 0, repos: new Set<string>() };
    byDay.set(key, fresh);
    return fresh;
  };

  for (const run of runs) ensure(dayBounds(run.date).periodStart.toISOString());
  for (const row of rows) {
    if (!row.timestamp) continue;
    const entry = ensure(dayBounds(row.timestamp).periodStart.toISOString());
    entry.events += 1;
    if (row.repo) entry.repos.add(row.repo);
  }

  return [...byDay.entries()].map(([date, entry]) => ({
    date,
    totalEvents: entry.events,
    distinctRepos: entry.repos.size,
  }));
}

const buildDayOutlineStep = createStep({
  id: "build-day-outline",
  description:
    "Plan the day's post: a headline, a throughline premise, and the sections the day's own material actually earns.",
  inputSchema: dayResearchOutputSchema,
  outputSchema: z.array(daySectionJobSchema),
  execute: async ({ inputData }) => {
    const prompt = buildDayOutlinePrompt(inputData);
    const startedAt = new Date().toISOString();
    const raw = await runNewspaperAgent(dayPostOutlineAgent, {
      user: prompt,
      aiModel: inputData.aiModel,
    });
    const endedAt = new Date().toISOString();
    // Same parser as the profile outline, not a copy of it: the plain-text
    // convention in `DAY_POST_OUTLINE_SYSTEM` is deliberately the one
    // `parseOutline` already reads, and its `KIND:` handling simply never fires
    // here because this prompt never asks for the line.
    const outline = parseOutline(raw);
    if (outline.sections.length === 0) {
      throw new Error("The day outline call produced no sections to write.");
    }

    const outlineTrace = { prompt, response: raw, startedAt, endedAt };
    const title = outline.title || `Dispatch — ${inputData.day}`;

    return outline.sections.map((section, index) => ({
      index,
      heading: section.heading,
      brief: section.brief,
      repo: matchSectionRepo(section.sourceRef, inputData.context.repos),
      // Every section gets the whole day's material, unlike the profile
      // pipeline's per-section excerpts: a day's source text is already small
      // (its activity plus a few repo lines), so chunking it would cost a
      // section the context that its own repo's activity sits inside.
      sourceText: inputData.sourceText,
      premise: outline.premise,
      title,
      aiModel: inputData.aiModel,
      outlineTrace,
      context: inputData.context,
    }));
  },
});

/** Whole body in try/catch, not just the model call — same reason as `write-section` (`./profile.ts:770-777`): a step failure inside a `foreach` kills the whole queue. */
const writeDaySectionStep = createStep({
  id: "write-day-section",
  description: "Write one section of the day's post.",
  inputSchema: daySectionJobSchema,
  outputSchema: daySectionOutcomeSchema,
  execute: async ({ inputData }) => {
    const prompt = buildDaySectionPrompt({ ...inputData, day: inputData.context.day });
    const startedAt = new Date().toISOString();
    try {
      const raw = await runNewspaperAgent(dayPostSectionAgent, {
        user: prompt,
        aiModel: inputData.aiModel,
      });
      return {
        ...inputData,
        ok: true,
        // `assemble-day-post` adds the real `## heading`; a section writer told
        // "no headline" writes one anyway often enough that leaving it would
        // visibly duplicate every heading.
        markdown: stripLeadingHeadingLine(raw),
        prompt,
        response: raw,
        startedAt,
        endedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      console.error(`[day-post] section "${inputData.heading}" failed: ${describe(error)}`);
      return {
        ...inputData,
        ok: false,
        markdown: null,
        prompt,
        response: null,
        startedAt,
        endedAt: new Date().toISOString(),
        error: describe(error),
      };
    }
  },
});

/** No LLM call — mechanical join, the `GenerationTrace`, and the two writes this workflow exists to produce. */
const assembleDayPostStep = createStep({
  id: "assemble-day-post",
  description: "Join the sections into the day's post, record the generation trace, and write the Article and its repo mentions.",
  inputSchema: z.array(daySectionOutcomeSchema),
  outputSchema: dayPostResultSchema,
  execute: async ({ inputData }) => {
    const sorted = [...inputData].sort((a, b) => a.index - b.index);
    const first = sorted[0];
    const { editionId, day } = first.context;
    const { dayStart } = boundsForDay(day);

    // Shared with the profile pipeline, not reimplemented: it is what adds each
    // `## heading`, the failed-section placeholder, and the anchor-checked
    // table of contents (which a day's 1-4 sections simply never reach the
    // minimum for).
    const content = assembleProfileContent(
      first.premise,
      sorted.map((section) => ({
        heading: section.heading,
        markdown: section.ok ? section.markdown : null,
      })),
    );

    const succeeded = sorted.filter((section) => section.ok).length;
    const status: GenerationTrace["status"] =
      succeeded === sorted.length ? "success" : succeeded > 0 ? "partial" : "failed";

    // Exactly the shape `assemble-article` builds, which is the whole reason
    // `GenerationTraceGraph` renders this with no changes. `research` is
    // omitted (it is optional): its fields describe fetched repo documentation,
    // and `research-day` fetches nothing — recording zeros there would read as
    // "we looked and found nothing" rather than "there was nothing to look for".
    const generationTrace: GenerationTrace = generationTraceSchema.parse({
      workflowId: "day-post",
      startedAt: first.context.startedAt,
      endedAt: new Date().toISOString(),
      status,
      outline: {
        prompt: first.outlineTrace.prompt,
        response: first.outlineTrace.response,
        title: first.title,
        premise: first.premise,
        startedAt: first.outlineTrace.startedAt,
        endedAt: first.outlineTrace.endedAt,
      },
      sections: sorted.map((section) => ({
        index: section.index,
        heading: section.heading,
        brief: section.brief,
        status: section.ok ? "success" : "failed",
        prompt: section.prompt,
        response: section.response ?? undefined,
        startedAt: section.startedAt,
        endedAt: section.endedAt,
        error: section.error ?? undefined,
      })),
    });

    const repoMentions = collectRepoMentions(sorted, content, first.context.repos);
    const sourceData = JSON.stringify({
      generator: "day-post",
      model: MODEL_NAME,
      generationTrace,
    });

    const { _max } = await prisma.article.aggregate({ where: { editionId }, _max: { order: true } });
    const article = await prisma.article.upsert({
      // `(editionId, dayDate)` is unique, so a re-generated day replaces its
      // post in place — same row, same id, so any link to it survives.
      where: { editionId_dayDate: { editionId, dayDate: dayStart } },
      create: {
        editionId,
        dayDate: dayStart,
        date: dayStart,
        title: first.title,
        content,
        category: DAY_POST_CATEGORY,
        author: DAY_POST_AUTHOR,
        deck: content.charAt(0) || "A",
        order: (_max.order ?? 0) + 1,
        sourceType: AI_SOURCE_TYPE,
        sourceData,
      },
      update: { title: first.title, content, deck: content.charAt(0) || "A", sourceData },
    });

    // Replace, never append: the mentions must describe the content that is on
    // the row *now*, and a re-generated post may well cover different repos.
    await prisma.$transaction([
      prisma.articleRepoMention.deleteMany({ where: { articleId: article.id } }),
      ...(repoMentions.length > 0
        ? [
            prisma.articleRepoMention.createMany({
              data: repoMentions.map((repoFullName) => ({ articleId: article.id, repoFullName })),
            }),
          ]
        : []),
    ]);

    return {
      articleId: article.id,
      title: article.title,
      status,
      sectionCount: sorted.length,
      repoMentions,
    };
  },
});

export const dayPostWorkflow = createWorkflow({
  id: "day-post",
  description: "Write one day's post from that day's already-stored activity, via an outline-then-sections pipeline.",
  inputSchema: dayPostInputSchema,
  outputSchema: dayPostResultSchema,
})
  .then(researchDayStep)
  .then(buildDayOutlineStep)
  .foreach(writeDaySectionStep, { concurrency: DAY_SECTION_CONCURRENCY })
  .then(assembleDayPostStep)
  .commit();
