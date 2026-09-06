/**
 * Chronicle workflow — service activity → one article per newspaper section.
 *
 * Faithful port of `app/services/generators/chronicle.py`: the category list,
 * the event→category map, the per-category instructions, the grouping rule and
 * the prompt template are all unchanged, so the printed paper reads the same.
 *
 * Shape:
 *   group-activities  →  foreach(write-category-article)  →  collect-articles
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  MODEL_NAME,
  chronicleAgent,
  parseResponse,
  runNewspaperAgent,
} from "../agents";
import {
  type ActivityInput,
  type GeneratorResult,
  activityInputSchema,
  generatorResultSchema,
} from "../schemas";

/** Verbatim from `chronicle.py:CATEGORIES` — also the output ordering. */
export const CATEGORIES = [
  "Open Source",
  "Project Updates",
  "Community",
  "Technology",
  "Discoveries",
  "Culture",
  "General",
] as const;

export type ChronicleCategory = (typeof CATEGORIES)[number];

/**
 * Verbatim from `chronicle.py:EVENT_CATEGORY_MAP`, plus one addition:
 *
 * `blog_post` → "General". The blog RSS source is new in the rewrite, and
 * "General" ("the miscellaneous happenings of the month") is the only prompt
 * that does not misframe a written post — "Culture" is specifically a
 * *Sounds of the Month* music column and would produce nonsense. Unmapped
 * event types already fall back to "General", so this entry is documentation
 * as much as behaviour.
 */
export const EVENT_CATEGORY_MAP: Record<string, ChronicleCategory> = {
  commit: "Open Source",
  pr: "Open Source",
  review: "Open Source",
  issue: "Community",
  release: "Project Updates",
  repo_created: "Project Updates",
  gist: "Technology",
  star: "Discoveries",
  spotify_track: "Culture",
  spotify_artist: "Culture",
  spotify_played: "Culture",
  blog_post: "General",
};

/** Verbatim from `chronicle.py:CATEGORY_PROMPTS`. */
export const CATEGORY_PROMPTS: Record<ChronicleCategory, string> = {
  "Open Source":
    "Focus on the coding craftsmanship: the commits pushed, the pull requests " +
    "opened and reviewed, the careful labour of the software artisan.",
  "Project Updates":
    "Celebrate the milestones: new repositories brought into the world and " +
    "software releases proclaimed to the public.",
  Community:
    "Chronicle the discourse: issues raised, questions posed, conversations " +
    "had in the great bazaar of open-source collaboration.",
  Technology:
    "Illuminate the craft: gists shared, snippets of wisdom distributed to " +
    "the wider technical community.",
  Discoveries:
    "Write a 'Repos of the Month' roundup in the style of a society column — " +
    "each starred repository introduced as a remarkable new acquaintance. " +
    "Include the repo name and a brief description of why it is worthy of note.",
  Culture:
    "Write a 'Sounds of the Month' column. Report the top tracks and artists " +
    "as though reviewing a concert season — grandiloquent, opinionated, and " +
    "enthusiastic. List the top tracks and artists with their Spotify URLs.",
  General:
    "Cover the miscellaneous happenings of the month with characteristic flair.",
};

/** Activities summarised into a single prompt are capped, as in Python. */
const MAX_ACTIVITIES_PER_GROUP = 25;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Bucket activities by category, preserving `CATEGORIES` order and dropping
 * empty buckets. Ported from `chronicle.py:_group_activities`.
 */
export function groupActivities(
  activities: ActivityInput[],
): Map<ChronicleCategory, ActivityInput[]> {
  const groups = new Map<ChronicleCategory, ActivityInput[]>(
    CATEGORIES.map((category) => [category, [] as ActivityInput[]]),
  );
  for (const activity of activities) {
    const category = EVENT_CATEGORY_MAP[activity.eventType] ?? "General";
    groups.get(category)!.push(activity);
  }
  for (const [category, group] of groups) {
    if (group.length === 0) groups.delete(category);
  }
  return groups;
}

/**
 * Render one group as the bullet list handed to the model.
 * Ported from `chronicle.py:_summarise_group` (Python's `%b %d` date format).
 */
export function summariseGroup(group: ActivityInput[]): string {
  return group
    .slice(0, MAX_ACTIVITIES_PER_GROUP)
    .map((act) => {
      const ts = act.timestamp
        ? `${MONTHS_SHORT[act.timestamp.getUTCMonth()]} ${String(
            act.timestamp.getUTCDate(),
          ).padStart(2, "0")}`
        : "";
      const repo = act.repo ?? "";
      return `- [${act.eventType || "?"}] ${repo}: ${act.title ?? ""} (${ts}) ${act.url ?? ""}`;
    })
    .join("\n");
}

/**
 * The user prompt for one section. Ported verbatim from
 * `chronicle.py:generate_from_activities`.
 */
export function buildChroniclePrompt(
  category: ChronicleCategory,
  periodLabel: string,
  summary: string,
): string {
  const categoryInstruction =
    CATEGORY_PROMPTS[category] ?? CATEGORY_PROMPTS.General;
  return (
    `Write a newspaper article for the '${category}' section of the ` +
    `${periodLabel} edition of ¡Albricias!.\n\n` +
    `${categoryInstruction}\n\n` +
    `Base it on the following activity:\n${summary}\n\n` +
    `Give the article a compelling headline (as a markdown H1), then the ` +
    `body text. Do not include a byline or date — those are added separately.`
  );
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const chronicleInputSchema = z.object({
  activities: z.array(activityInputSchema),
  /**
   * Human-readable period label for the edition, e.g. `"March 2026"`.
   * Comes from `periodLabel()` in `src/lib/edition-helpers.ts`.
   */
  periodLabel: z.string(),
  /** Defaults to `OPENAI_API_KEY`. */
  apiKey: z.string().optional(),
});

const categoryJobSchema = z.object({
  category: z.string(),
  prompt: z.string(),
  fallbackTitle: z.string(),
  activityCount: z.number(),
  apiKey: z.string().optional(),
});

/** One job's outcome; a failed section is skipped, never fatal. */
const categoryOutcomeSchema = z.object({
  ok: z.boolean(),
  result: generatorResultSchema.nullable(),
});

const groupActivitiesStep = createStep({
  id: "group-activities",
  description:
    "Bucket activity rows by newspaper section and build one prompt per section.",
  inputSchema: chronicleInputSchema,
  outputSchema: z.array(categoryJobSchema),
  execute: async ({ inputData }) => {
    const groups = groupActivities(inputData.activities);
    return [...groups].map(([category, group]) => ({
      category,
      prompt: buildChroniclePrompt(
        category,
        inputData.periodLabel,
        summariseGroup(group),
      ),
      fallbackTitle: `${category} Dispatch — ${inputData.periodLabel}`,
      activityCount: group.length,
      apiKey: inputData.apiKey,
    }));
  },
});

const writeCategoryArticleStep = createStep({
  id: "write-category-article",
  description: "Ask the chronicle desk for one section's dispatch.",
  inputSchema: categoryJobSchema,
  outputSchema: categoryOutcomeSchema,
  execute: async ({ inputData }) => {
    let raw: string;
    try {
      raw = await runNewspaperAgent(chronicleAgent, {
        user: inputData.prompt,
        apiKey: inputData.apiKey,
      });
    } catch (error) {
      // `chronicle.py` logs and `continue`s so one bad section never sinks
      // the whole edition.
      console.error(
        `[chronicle] OpenAI call failed for '${inputData.category}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false, result: null };
    }

    const { title, content } = parseResponse(raw, inputData.fallbackTitle);
    return {
      ok: true,
      result: {
        title,
        content,
        category: inputData.category,
        sourceData: {
          generator: "chronicle",
          prompt: inputData.prompt,
          response: raw,
          model: MODEL_NAME,
          activity_count: inputData.activityCount,
        },
      },
    };
  },
});

const collectArticlesStep = createStep({
  id: "collect-articles",
  description: "Drop the sections whose generation failed.",
  inputSchema: z.array(categoryOutcomeSchema),
  outputSchema: z.array(generatorResultSchema),
  execute: async ({ inputData }) =>
    inputData
      .filter((outcome) => outcome.ok && outcome.result !== null)
      .map((outcome) => outcome.result as GeneratorResult),
});

/**
 * Activity rows → one `GeneratorResult` per non-empty newspaper section.
 *
 * Sections are written one at a time (`concurrency: 1`) to match the Python
 * loop and to stay well inside OpenAI rate limits.
 */
export const chronicleWorkflow = createWorkflow({
  id: "chronicle",
  description:
    "Group service activity by newspaper section and write one vintage dispatch per section.",
  inputSchema: chronicleInputSchema,
  outputSchema: z.array(generatorResultSchema),
})
  .then(groupActivitiesStep)
  .foreach(writeCategoryArticleStep, { concurrency: 1 })
  .then(collectArticlesStep)
  .commit();

export type ChronicleInput = z.infer<typeof chronicleInputSchema>;
