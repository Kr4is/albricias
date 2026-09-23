/**
 * Period-post workflow — research → outline → per-section drafts → assemble.
 *
 * Forked from the deleted `day-post.ts` (single-tenant, DB-backed) for the
 * stateless self-serve flow: given one already-fetched batch of GitHub
 * activity for a period, produce the sections of a front page in memory.
 * Nothing here reads or writes a database, and nothing persists.
 *
 * Shape: research → outline → foreach(write-section, { concurrency: 1 }) → assemble.
 *
 * Two deliberate differences from the old day-post pipeline, both following
 * from "this is a one-shot request with no history to draw on":
 *   1. `research` only has the activity handed to it — no "Repository
 *      facts", "Previously covered", or "Activity trend" blocks, since all
 *      three need cross-run history a stateless request doesn't have.
 *   2. `assemble` returns the sections directly (each becomes one front-page
 *      article) instead of joining them into a single persisted `Article`.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { periodPostOutlineAgent, periodPostSectionAgent } from "../agents";
import { runNewspaperAgent, stripLeadingHeadingLine } from "../agents/base";
import { type ActivityInput, activityInputSchema, resolvedAiModelSchema } from "../schemas";

/** The self-hosted model behind a LiteLLM proxy drops connections under concurrent load. */
export const SECTION_CONCURRENCY = 1;

type Cadence = "daily" | "weekly" | "monthly";

/** How many sections a period's material may support — a quiet period should still propose fewer. */
const SECTION_RANGE: Record<Cadence, readonly [number, number]> = {
  daily: [1, 4],
  weekly: [3, 6],
  monthly: [5, 9],
};

const MAX_ACTIVITIES_LISTED = 25;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `{ commit: 7, star: 2 }` → `"7 commit, 2 star"`, busiest kind first. */
function countByEventType(activity: ActivityInput[]): string {
  const counts = new Map<string, number>();
  for (const item of activity) counts.set(item.eventType, (counts.get(item.eventType) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
}

/** Up to `MAX_ACTIVITIES_LISTED` events as plain-text lines, newest material first. */
function summariseActivity(activity: ActivityInput[]): string {
  return activity
    .slice(0, MAX_ACTIVITIES_LISTED)
    .map((item) => {
      const ts = item.timestamp
        ? `${MONTHS_SHORT[item.timestamp.getUTCMonth()]} ${String(item.timestamp.getUTCDate()).padStart(2, "0")}`
        : "";
      return `- [${item.eventType || "?"}] ${item.repo ?? ""}: ${item.title ?? ""} (${ts}) ${item.url ?? ""}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const periodPostInputSchema = z.object({
  periodLabel: z.string(),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  activity: z.array(activityInputSchema),
  aiModel: resolvedAiModelSchema.optional(),
});
export type PeriodPostWorkflowInput = z.input<typeof periodPostInputSchema>;

const researchOutputSchema = periodPostInputSchema.extend({
  sourceText: z.string(),
});

const sectionJobSchema = z.object({
  index: z.number().int(),
  heading: z.string(),
  brief: z.string(),
  sourceText: z.string(),
  premise: z.string(),
  title: z.string(),
  periodLabel: z.string(),
  aiModel: resolvedAiModelSchema.optional(),
});

const sectionOutcomeSchema = sectionJobSchema.extend({
  ok: z.boolean(),
  content: z.string().nullable(),
});

export const periodPostResultSchema = z.object({
  title: z.string(),
  premise: z.string(),
  sections: z.array(
    z.object({ heading: z.string(), brief: z.string(), content: z.string() }),
  ),
});
export type PeriodPostResult = z.infer<typeof periodPostResultSchema>;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function buildOutlinePrompt(input: {
  periodLabel: string;
  minSections: number;
  maxSections: number;
  sourceText: string;
}): string {
  return (
    `The period being covered is ${input.periodLabel}.\n\n` +
    `Propose between ${input.minSections} and ${input.maxSections} sections for this outline.\n\n` +
    `Material:\n${input.sourceText}\n`
  );
}

export function buildSectionPrompt(input: {
  periodLabel: string;
  heading: string;
  brief: string;
  premise: string;
  sourceText: string;
}): string {
  return (
    `The period being covered is ${input.periodLabel}.\n\n` +
    `The post's overall premise: ${input.premise}\n\n` +
    `Write the section titled "${input.heading}". ${input.brief}\n\n` +
    `The period's material:\n${input.sourceText}\n`
  );
}

interface ParsedOutlineSection {
  heading: string;
  brief: string;
}

interface ParsedOutline {
  title: string;
  premise: string;
  sections: ParsedOutlineSection[];
}

/** Reads the `# headline` / `PREMISE:` / `## heading` / `BRIEF:` shape `PERIOD_POST_OUTLINE_SYSTEM` asks for. */
export function parseOutline(raw: string): ParsedOutline {
  const lines = raw.trim().split("\n");
  let title = "";
  let premise = "";
  const sections: ParsedOutlineSection[] = [];
  let current: ParsedOutlineSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), brief: "" };
    } else if (line.startsWith("PREMISE:")) {
      premise = line.slice("PREMISE:".length).trim();
    } else if (line.startsWith("BRIEF:") && current) {
      current.brief = line.slice("BRIEF:".length).trim();
    }
  }
  if (current) sections.push(current);

  return { title, premise, sections: sections.filter((section) => section.heading) };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** No LLM call, no network call — just renders the already-fetched activity as one labeled block. */
const researchStep = createStep({
  id: "research",
  description: "Render the period's fetched GitHub activity as a labeled source block.",
  inputSchema: periodPostInputSchema,
  outputSchema: researchOutputSchema,
  execute: async ({ inputData }) => {
    const { activity } = inputData;
    if (activity.length === 0) {
      throw new Error("No GitHub activity recorded for this period — there is nothing to write about.");
    }
    const repoCount = new Set(activity.map((item) => item.repo).filter(Boolean)).size;
    const header = `${activity.length} recorded events across ${repoCount} repositories: ${countByEventType(activity)}.`;
    const sourceText = `## Activity\n\n${header}\n\n${summariseActivity(activity)}`;
    return { ...inputData, sourceText };
  },
});

const buildOutlineStep = createStep({
  id: "build-outline",
  description: "Plan the period's post: a headline, a throughline premise, and the sections the material earns.",
  inputSchema: researchOutputSchema,
  outputSchema: z.array(sectionJobSchema),
  execute: async ({ inputData }) => {
    const [minSections, maxSections] = SECTION_RANGE[inputData.cadence];
    const prompt = buildOutlinePrompt({
      periodLabel: inputData.periodLabel,
      minSections,
      maxSections,
      sourceText: inputData.sourceText,
    });
    const raw = await runNewspaperAgent(periodPostOutlineAgent, { user: prompt, aiModel: inputData.aiModel });
    const outline = parseOutline(raw);
    if (outline.sections.length === 0) {
      throw new Error("The outline call produced no sections to write.");
    }

    const title = outline.title || inputData.periodLabel;
    return outline.sections.map((section, index) => ({
      index,
      heading: section.heading,
      brief: section.brief,
      sourceText: inputData.sourceText,
      premise: outline.premise,
      title,
      periodLabel: inputData.periodLabel,
      aiModel: inputData.aiModel,
    }));
  },
});

/** Whole body in try/catch — a step failure inside a `foreach` would otherwise kill the whole queue. */
const writeSectionStep = createStep({
  id: "write-section",
  description: "Write one section of the period's post.",
  inputSchema: sectionJobSchema,
  outputSchema: sectionOutcomeSchema,
  execute: async ({ inputData }) => {
    const prompt = buildSectionPrompt(inputData);
    try {
      const raw = await runNewspaperAgent(periodPostSectionAgent, { user: prompt, aiModel: inputData.aiModel });
      return { ...inputData, ok: true, content: stripLeadingHeadingLine(raw) };
    } catch (error) {
      console.error(`[period-post] section "${inputData.heading}" failed: ${describe(error)}`);
      return { ...inputData, ok: false, content: null };
    }
  },
});

/** No LLM call — just sorts and filters the sections that actually wrote. */
const assembleStep = createStep({
  id: "assemble",
  description: "Collect the successfully written sections into the finished post.",
  inputSchema: z.array(sectionOutcomeSchema),
  outputSchema: periodPostResultSchema,
  execute: async ({ inputData }) => {
    const sorted = [...inputData].sort((a, b) => a.index - b.index);
    const written = sorted.filter((section): section is typeof section & { content: string } => section.ok && section.content !== null);
    if (written.length === 0) {
      throw new Error("Every section failed to generate — nothing to show.");
    }
    return {
      title: sorted[0].title,
      premise: sorted[0].premise,
      sections: written.map((section) => ({
        heading: section.heading,
        brief: section.brief,
        content: section.content,
      })),
    };
  },
});

export const periodPostWorkflow = createWorkflow({
  id: "period-post",
  description: "Write a GitHub user's period post from their already-fetched activity, via an outline-then-sections pipeline.",
  inputSchema: periodPostInputSchema,
  outputSchema: periodPostResultSchema,
})
  .then(researchStep)
  .then(buildOutlineStep)
  .foreach(writeSectionStep, { concurrency: SECTION_CONCURRENCY })
  .then(assembleStep)
  .commit();
