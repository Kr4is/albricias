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
  resolvedAiModelSchema,
} from "../schemas";

/**
 * Verbatim from `chronicle.py:CATEGORIES` — also the output ordering — plus
 * two additions: `"Podcasts"` (see the rationale note below
 * `EVENT_CATEGORY_MAP`) and `"Bookshelf"` (Alexandria reading activity, Phase
 * G). Like `Culture`/`Discoveries`, these are chronicle-only section names
 * and deliberately do not appear in `ARTICLE_CATEGORIES`
 * (`src/lib/article-categories.ts`), the admin's manual-article category
 * dropdown — that mismatch already exists for the other AI-only sections.
 */
export const CATEGORIES = [
  "Open Source",
  "Project Updates",
  "Community",
  "Technology",
  "Discoveries",
  "Culture",
  "Podcasts",
  "Bookshelf",
  "General",
] as const;

export type ChronicleCategory = (typeof CATEGORIES)[number];

/**
 * Verbatim from `chronicle.py:EVENT_CATEGORY_MAP`, plus two additions:
 *
 * `blog_post` → "General". The blog RSS source is new in the rewrite, and
 * "General" ("the miscellaneous happenings of the month") is the only prompt
 * that does not misframe a written post — "Culture" is specifically a
 * *Sounds of the Month* music column and would produce nonsense. Unmapped
 * event types already fall back to "General", so this entry is documentation
 * as much as behaviour.
 *
 * `spotify_podcast_episode` → "Podcasts" (new category, not folded into
 * "Culture"). "Culture"'s prompt is a music-review voice — "reviewing a
 * concert season" and listing "top tracks and artists with their Spotify
 * URLs" — which doesn't fit narrating *what was listened to on a podcast*.
 * Rather than stretch one prompt to cover two different kinds of listening
 * (and produce a muddled or misleading column when both are present in the
 * same period), podcasts get their own section with its own newspaper-voice
 * prompt, same as how "Discoveries" (starred repos) got its own column
 * instead of being folded into "Technology". If podcast activity later turns
 * out to be sparse in practice, folding it back into "Culture" under a
 * combined "Sounds & Stories" prompt would be the natural walk-back.
 *
 * `book_finished`/`book_reading` → "Bookshelf" (new category, Phase G /
 * Alexandria). Same reasoning as Podcasts: a finished-books column is its
 * own kind of narration (author, personal rating, personal notes) that
 * doesn't fit "Culture"'s music-review voice or any existing section.
 * `book_reading` (the currently-reading snapshot from Alexandria — see
 * `@/lib/sources/alexandria.ts`) is folded into the same column rather than
 * given its own, so the Bookshelf piece can end on a "currently reading"
 * teaser the way a real books page often does.
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
  spotify_podcast_episode: "Podcasts",
  book_finished: "Bookshelf",
  book_reading: "Bookshelf",
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
  Podcasts:
    "Write a 'Voices from the Wireless' column narrating the podcast episodes " +
    "listened to this period, as though reporting from the salons and lecture " +
    "halls where ideas are discussed aloud — erudite, curious, and a little " +
    "theatrical. Name each episode and its show, note what it was about, and " +
    "include the Spotify URLs.",
  Bookshelf:
    "Write a 'From the Bookshelf' column for the literary page. Narrate the " +
    "books finished this period as though reviewing for a discerning " +
    "readership — warm, erudite, appreciative of a well-turned phrase. Name " +
    "each book and its author, and where a personal rating or note is given, " +
    "weave it in as the reader's own verdict. If a book is currently being " +
    "read, close with a brief, teasing mention of it as the chapter still " +
    "unfolding.",
  General:
    "Cover the miscellaneous happenings of the month with characteristic flair.",
};

/** Activities summarised into a single prompt are capped, as in Python. */
const MAX_ACTIVITIES_PER_GROUP = 25;

/**
 * How many sections are written at once by the `foreach` below.
 *
 * Three is a deliberately conservative default: it is comfortably inside the
 * per-minute request limits of every cloud provider this app can be pointed at
 * (OpenAI, Gemini) even on their lowest tiers, while still cutting a nine-
 * section edition from nine round-trips to three. A local LiteLLM/Ollama
 * backend that serialises requests server-side simply won't go faster than its
 * own concurrency — no speedup, but no regression either. One constant so it
 * stays trivially tunable (see the plan's follow-up about making it a setting).
 */
export const CHRONICLE_CONCURRENCY = 3;

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
  /**
   * `Article.order` for the first section written by this run — every
   * subsequent section takes `baseOrder + n`. Assigned once by the caller
   * (`generateEditionDraft`) from the edition's current `max(order) + 1`
   * instead of being queried per write, because concurrent writers would
   * otherwise all read the same `max(order)` and collide.
   */
  baseOrder: z.number().int(),
  /** Resolved AI text-generation provider/model — see `@/lib/ai/provider`. */
  aiModel: resolvedAiModelSchema.optional(),
});

const categoryJobSchema = z.object({
  category: z.string(),
  prompt: z.string(),
  fallbackTitle: z.string(),
  activityCount: z.number(),
  /** This section's pre-assigned `Article.order` — see `baseOrder` above. */
  order: z.number().int(),
  aiModel: resolvedAiModelSchema.optional(),
});

/** One job's outcome; a failed section is skipped, never fatal. */
const categoryOutcomeSchema = z.object({
  ok: z.boolean(),
  result: generatorResultSchema.nullable(),
  /** Echoed back so the persisting caller never has to re-derive it. */
  order: z.number().int(),
});

const groupActivitiesStep = createStep({
  id: "group-activities",
  description:
    "Bucket activity rows by newspaper section and build one prompt per section.",
  inputSchema: chronicleInputSchema,
  outputSchema: z.array(categoryJobSchema),
  execute: async ({ inputData }) => {
    const groups = groupActivities(inputData.activities);
    return [...groups].map(([category, group], index) => ({
      category,
      prompt: buildChroniclePrompt(
        category,
        inputData.periodLabel,
        summariseGroup(group),
      ),
      fallbackTitle: `${category} Dispatch — ${inputData.periodLabel}`,
      activityCount: group.length,
      order: inputData.baseOrder + index,
      aiModel: inputData.aiModel,
    }));
  },
});

/**
 * The whole body is inside one try/catch — not just the model call — because a
 * *Mastra-level* step failure inside a `foreach` calls `killQueue()`, which
 * drops every iteration that has not started yet (verified in
 * `@mastra/core/dist/agent-DsRUDsS_.js:1461-1509`; it applies at any
 * concurrency). Resolving every error as a normal `{ ok: false }` outcome makes
 * "one section's trouble never touches the others" a property of this step
 * rather than a side effect of the only known failure being caught by accident.
 */
const writeCategoryArticleStep = createStep({
  id: "write-category-article",
  description: "Ask the chronicle desk for one section's dispatch.",
  inputSchema: categoryJobSchema,
  outputSchema: categoryOutcomeSchema,
  execute: async ({ inputData }) => {
    try {
      const raw = await runNewspaperAgent(chronicleAgent, {
        user: inputData.prompt,
        aiModel: inputData.aiModel,
      });
      const { title, content } = parseResponse(raw, inputData.fallbackTitle);
      return {
        ok: true,
        order: inputData.order,
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
    } catch (error) {
      // `chronicle.py` logs and `continue`s so one bad section never sinks
      // the whole edition.
      console.error(
        `[chronicle] section '${inputData.category}' failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false, order: inputData.order, result: null };
    }
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
 * Sections are written {@link CHRONICLE_CONCURRENCY} at a time, so one slow or
 * failing section neither blocks nor invalidates the rest — the Python loop's
 * strict sequencing was never a requirement of the output, only of its
 * implementation. Iterations therefore finish out of order: anything consuming
 * this workflow's progress stream must key off the iteration's own index, not
 * off "the next section".
 */
export const chronicleWorkflow = createWorkflow({
  id: "chronicle",
  description:
    "Group service activity by newspaper section and write one vintage dispatch per section.",
  inputSchema: chronicleInputSchema,
  outputSchema: z.array(generatorResultSchema),
})
  .then(groupActivitiesStep)
  .foreach(writeCategoryArticleStep, { concurrency: CHRONICLE_CONCURRENCY })
  .then(collectArticlesStep)
  .commit();

export type ChronicleInput = z.infer<typeof chronicleInputSchema>;
