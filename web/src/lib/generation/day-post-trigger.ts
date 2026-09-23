/**
 * Starting — and tracking — one day's post-generation run
 * (`@/mastra/workflows/day-post`).
 *
 * The workflow itself writes the `Article` and its `ArticleRepoMention` rows;
 * everything this file owns sits *around* that call: the two guards that decide
 * whether a run should happen at all, and the `DayProcessingRun.postStatus` /
 * `postProgress` columns that make a 6-11 minute run visible while it happens.
 *
 * Its own file rather than another function in `./daily.ts` for the same reason
 * `./day-trend.ts` is: this is the post pipeline, and `daily.ts` is the activity
 * pipeline. They meet at exactly one call
 * ({@link runTrackedDayProcessing} → {@link runTrackedDayPostGeneration}).
 *
 * Two guards, both deliberately silent no-ops rather than failures:
 *
 *   1. **Idempotency** — a day that already has a post is left alone, so
 *      re-processing a day's *activity* never re-burns a multi-minute LLM run
 *      on a post that is already good. The explicit "Regenerate post" action
 *      (`.../day/[date]/generate-post`) passes `force` to override it.
 *   2. **Activity** — `research-day` throws on a day with no `ServiceActivity`
 *      rows, and a genuinely empty day is not a failure, so it must never reach
 *      the workflow and record `postStatus: "failed"` for one.
 *
 * Status is written *before* the run starts (and progress as it streams), the
 * same "the row says running before the work begins" ordering the day-process
 * route already relies on: a page load one second after the trigger has to see
 * `running`, not a day that looks untouched for the next ten minutes.
 */

import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { dayBounds } from "@/lib/cadence";
import { describeError } from "@/lib/flash";
import { prisma } from "@/lib/prisma";
import { DAY_TREND_WINDOW_DAYS, dayPostWorkflow } from "@/mastra/workflows";

import type { DayPostProgress } from "./day-status";

/**
 * The `day-post` workflow's steps, in the order it chains them
 * (`@/mastra/workflows/day-post`: `.then(research).then(outline)
 * .foreach(writeSection).then(assemble)`). These strings are the
 * `createStep({ id })` values Mastra puts on every `workflow-step-*` chunk's
 * `payload.id` — the same id→label lookup (and the same guard against
 * labelling an unrecognised id) `applyProfileStepProgress` (`./index.ts`) does
 * for the profile workflow.
 */
const DAY_POST_STEP_IDS = [
  "research-day",
  "build-day-outline",
  "write-day-section",
  "assemble-day-post",
] as const;

/** Sections written so far, as the `foreach`'s own progress chunk reports them. */
interface SectionCounts {
  completed: number;
  total: number;
}

const DAY_POST_STEP_LABELS: Record<(typeof DAY_POST_STEP_IDS)[number], (counts: SectionCounts | null) => string> = {
  "research-day": () => "Reading the day's activity…",
  "build-day-outline": () => "Planning the outline…",
  "write-day-section": (counts) =>
    counts ? `Writing section ${Math.min(counts.completed + 1, counts.total)} of ${counts.total}…` : "Writing the sections…",
  "assemble-day-post": () => "Assembling the post…",
};

/** `{ step, totalSections, completedSections }` for a step id, or `null` for an id this workflow doesn't have. */
function progressFor(stepId: string, counts: SectionCounts | null): DayPostProgress | null {
  const index = DAY_POST_STEP_IDS.indexOf(stepId as (typeof DAY_POST_STEP_IDS)[number]);
  if (index === -1) return null;
  return {
    step: {
      id: stepId,
      label: DAY_POST_STEP_LABELS[stepId as (typeof DAY_POST_STEP_IDS)[number]](counts),
      index: index + 1,
      total: DAY_POST_STEP_IDS.length,
    },
    totalSections: counts?.total,
    completedSections: counts?.completed,
  };
}

/**
 * Write this day's post status/progress onto its `DayProcessingRun` row.
 *
 * An upsert rather than an update because the row is not guaranteed to exist:
 * only the manual per-day route records an attempt, so a day processed by the
 * automatic cron has none, and the "Regenerate post" action on such a day would
 * otherwise run for ten minutes with nothing anywhere to say so. The created
 * row's `status: "done"` is not a fabrication — this only runs after the
 * activity guard has counted real stored rows for the day.
 */
async function writePostRun(
  editionId: number,
  date: Date,
  postStatus: string,
  progress: DayPostProgress | null,
): Promise<void> {
  const postProgress = progress ? JSON.stringify(progress) : null;
  // Every `running` write is a heartbeat: the row only stops advancing when the
  // process holding it dies, which is exactly what `foldDayRun` reads to decide
  // a post run is stuck (`postStale`). Cleared once the run settles.
  const postHeartbeatAt = postStatus === "running" ? new Date() : null;
  await prisma.dayProcessingRun.upsert({
    where: { editionId_date: { editionId, date } },
    create: {
      editionId,
      date,
      status: "done",
      finishedAt: new Date(),
      hadActivity: true,
      postStatus,
      postProgress,
      postHeartbeatAt,
    },
    update: { postStatus, postProgress, postHeartbeatAt },
  });
}

/**
 * Generate the day's post, tracking it on the day's `DayProcessingRun` row —
 * the background half of both the automatic trigger (chained onto
 * `runTrackedDayProcessing`) and the explicit "Regenerate post" action.
 *
 * Never throws: like `runTrackedDayProcessing`, its callers are `after()`
 * blocks with nothing listening, and the failure is already durable on the row.
 *
 * @param force skip the "this day already has a post" guard — the explicit
 *   regenerate action, and only it. The workflow upserts on
 *   `(editionId, dayDate)`, so a forced run replaces the post in place.
 */
export async function runTrackedDayPostGeneration(
  editionId: number,
  dayStart: Date,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const day = dayStart.toISOString().slice(0, 10);
  const { periodEnd: dayEnd } = dayBounds(dayStart);

  if (!force) {
    const existing = await prisma.article.findUnique({
      where: { editionId_dayDate: { editionId, dayDate: dayStart } },
      select: { id: true },
    });
    if (existing) return;
  }

  const activityCount = await prisma.serviceActivity.count({
    where: { editionId, timestamp: { gte: dayStart, lt: dayEnd } },
  });
  if (activityCount === 0) return;

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    await writePostRun(editionId, dayStart, "failed", { error: AI_PROVIDER_NOT_CONFIGURED_MESSAGE });
    return;
  }

  await writePostRun(editionId, dayStart, "running", progressFor("research-day", null));

  try {
    const run = await dayPostWorkflow.createRun();
    // `run.stream()` rather than `run.start()` for the step events alone — same
    // pattern, and the same `stream.result` for the final outcome, as the
    // profile workflow's caller (`./index.ts`).
    // `trendWindowDays` is passed explicitly rather than left to its schema
    // default: `run.stream()` types `inputData` as the schema's *output*, where
    // the defaulted field is already required.
    const stream = run.stream({
      inputData: { editionId, day, aiModel, trendWindowDays: DAY_TREND_WINDOW_DAYS },
    });

    // Held across chunks rather than re-derived per chunk: a `foreach` fires a
    // `workflow-step-start` per iteration, and rebuilding the label without the
    // count would flicker "Writing section 2 of 5…" back to "Writing the
    // sections…" between every section.
    let counts: SectionCounts | null = null;

    for await (const chunk of stream.fullStream) {
      if (chunk.type === "workflow-step-start") {
        const progress = progressFor(chunk.payload.id, counts);
        if (progress) await writePostRun(editionId, dayStart, "running", progress);
      } else if (chunk.type === "workflow-step-progress" && chunk.payload.id === "write-day-section") {
        // `completedCount` names iterations *finished*, so the section actually
        // being written now is `completedCount + 1` — clamped in the label,
        // because the last iteration's event arrives with nothing left to write.
        counts = { completed: chunk.payload.completedCount, total: chunk.payload.totalCount };
        await writePostRun(editionId, dayStart, "running", progressFor("write-day-section", counts));
      }
    }

    const outcome = await stream.result;
    if (outcome.status !== "success") {
      throw new Error(
        `Day post generation failed (${outcome.status})`,
        outcome.status === "failed" ? { cause: outcome.error } : undefined,
      );
    }
    await writePostRun(editionId, dayStart, "done", null);
  } catch (error) {
    console.error(`Day post generation failed (edition ${editionId}, ${day}):`, error);
    await writePostRun(editionId, dayStart, "failed", { error: describeError(error) });
  }
}
