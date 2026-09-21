/**
 * In-process cron scheduler — two independent jobs, not one.
 *
 * **Period creation** (`scheduleCron`/`scheduleEnabled` settings, unchanged
 * keys from Phase A): on a fire, creates the `Edition` row for the current
 * period if none exists yet (`createDraftEdition`) — idempotent, so this
 * never duplicates or crashes. It used to also run the *entire* generation
 * pipeline in the same fire; that's now the daily job's responsibility, so
 * this only creates the empty draft.
 *
 * **Daily processing** (`dailyScheduleCron`/`dailyScheduleEnabled`, new):
 * on a fire, finds whichever edition covers the current period and walks
 * it forward day by day (`processMissedDays`, `@/lib/generation/daily`) —
 * fetching that day's activity, writing its dispatch, surfacing anything
 * newly interesting, and — on the period's last day — the ranking and
 * front-page compendium. Defaults to once daily at 04:00 UTC, deliberately
 * after most calendar days have already turned over everywhere, so a
 * day's activity is more likely complete before it's processed and the
 * result is ready to review first thing the next morning.
 *
 * The two are orthogonal: `cadence` (weekly vs. monthly, `@/lib/cadence`)
 * decides how long a period is; the daily cron processes whatever period
 * is currently open regardless of how long that period runs.
 *
 * Both tasks are cached on `globalThis`, the same pattern `@/lib/prisma`
 * uses for its `PrismaClient`, so a Next.js dev-mode module re-execution
 * (Fast Refresh) doesn't leak a second running cron task. Both register
 * functions always stop/destroy whatever's currently cached before
 * creating a new one, so either is safe to call again at runtime (e.g.
 * right after the admin saves a new schedule) without a server restart.
 */

import cron, { type ScheduledTask } from "node-cron";
import { currentPeriodBounds, getCadence } from "@/lib/cadence";
import { createDraftEdition } from "@/lib/generation";
import { processMissedDays } from "@/lib/generation/daily";
import { resolveAiModel } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";

const SCHEDULE_CRON_KEY = "scheduleCron";
const SCHEDULE_ENABLED_KEY = "scheduleEnabled";
const TASK_NAME = "edition-generation";

const DAILY_SCHEDULE_CRON_KEY = "dailyScheduleCron";
const DAILY_SCHEDULE_ENABLED_KEY = "dailyScheduleEnabled";
const DAILY_TASK_NAME = "edition-daily-processing";

/** Default cron expression offered in the admin UI before anything is saved. */
export const DEFAULT_SCHEDULE_CRON = "0 6 * * 1"; // Mondays at 06:00 UTC

/** Default daily-processing cron — 04:00 UTC, so a day's work is ready to review first thing the next morning. */
export const DEFAULT_DAILY_SCHEDULE_CRON = "0 4 * * *";

const globalForScheduler = globalThis as unknown as {
  editionSchedulerTask?: ScheduledTask;
  editionDailySchedulerTask?: ScheduledTask;
  editionSchedulerInitialized?: boolean;
};

export interface ScheduleSettings {
  cronExpr: string | null;
  enabled: boolean;
}

/** Read the current period-creation schedule settings from the `Setting` table. */
export async function getScheduleSettings(): Promise<ScheduleSettings> {
  const [cronRow, enabledRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: SCHEDULE_CRON_KEY } }),
    prisma.setting.findUnique({ where: { key: SCHEDULE_ENABLED_KEY } }),
  ]);
  return {
    cronExpr: cronRow?.value ?? null,
    enabled: enabledRow?.value === "true",
  };
}

/** Persist the period-creation schedule settings. Does not itself (re-)register the job — call {@link registerSchedule} after. */
export async function setScheduleSettings({ cronExpr, enabled }: { cronExpr: string; enabled: boolean }): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SCHEDULE_CRON_KEY },
    create: { key: SCHEDULE_CRON_KEY, value: cronExpr },
    update: { value: cronExpr },
  });
  await prisma.setting.upsert({
    where: { key: SCHEDULE_ENABLED_KEY },
    create: { key: SCHEDULE_ENABLED_KEY, value: String(enabled) },
    update: { value: String(enabled) },
  });
}

/** Read the current daily-processing schedule settings from the `Setting` table. */
export async function getDailyScheduleSettings(): Promise<ScheduleSettings> {
  const [cronRow, enabledRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: DAILY_SCHEDULE_CRON_KEY } }),
    prisma.setting.findUnique({ where: { key: DAILY_SCHEDULE_ENABLED_KEY } }),
  ]);
  return {
    cronExpr: cronRow?.value ?? null,
    enabled: enabledRow?.value === "true",
  };
}

/** Persist the daily-processing schedule settings. Does not itself (re-)register the job — call {@link registerDailySchedule} after. */
export async function setDailyScheduleSettings({
  cronExpr,
  enabled,
}: {
  cronExpr: string;
  enabled: boolean;
}): Promise<void> {
  await prisma.setting.upsert({
    where: { key: DAILY_SCHEDULE_CRON_KEY },
    create: { key: DAILY_SCHEDULE_CRON_KEY, value: cronExpr },
    update: { value: cronExpr },
  });
  await prisma.setting.upsert({
    where: { key: DAILY_SCHEDULE_ENABLED_KEY },
    create: { key: DAILY_SCHEDULE_ENABLED_KEY, value: String(enabled) },
    update: { value: String(enabled) },
  });
}

/** One fire of the period-creation job: create the current period's draft `Edition` if none exists yet. */
async function runScheduledGeneration(): Promise<void> {
  try {
    const cadence = await getCadence();
    const period = currentPeriodBounds(cadence);
    const outcome = await createDraftEdition(cadence, period.periodStart, period.periodEnd);

    if (outcome.status === "exists") {
      console.log(
        `[scheduler] Edition for the current ${cadence} period already exists (id ${outcome.edition.id}) — nothing to create.`,
      );
      return;
    }
    console.log(
      `[scheduler] Created draft edition ${outcome.edition.id} ("${outcome.edition.title}") for the current ${cadence} period — daily processing will populate it.`,
    );
  } catch (error) {
    // A scheduled run must never crash the server process — log and wait for the next fire.
    console.error("[scheduler] Scheduled edition creation failed:", error);
  }
}

/** One fire of the daily-processing job: catch the currently-open edition up to today (or its period's end). */
async function runScheduledDailyProcessing(): Promise<void> {
  try {
    const cadence = await getCadence();
    const period = currentPeriodBounds(cadence);
    const edition = await prisma.edition.findUnique({
      where: { cadence_periodStart: { cadence, periodStart: period.periodStart } },
    });
    if (!edition) {
      console.log(
        `[scheduler] No edition exists yet for the current ${cadence} period — nothing to process. It's created by the period-creation schedule.`,
      );
      return;
    }

    const aiModel = await resolveAiModel();
    const { processedDays, messages } = await processMissedDays(edition, aiModel ?? undefined);
    if (processedDays.length === 0) {
      console.log(`[scheduler] Edition ${edition.id}: no unprocessed days — already caught up.`);
      return;
    }
    console.log(
      `[scheduler] Edition ${edition.id}: processed ${processedDays.length} day(s) (${processedDays.join(", ")})` +
        (messages.length > 0 ? ` with ${messages.length} warning(s).` : "."),
    );
  } catch (error) {
    console.error("[scheduler] Scheduled daily processing failed:", error);
  }
}

/** Stop and discard the currently-registered period-creation cron task, if any. Safe to call when none is registered. */
export function unregisterSchedule(): void {
  const existing = globalForScheduler.editionSchedulerTask;
  if (!existing) return;
  existing.stop();
  void existing.destroy();
  globalForScheduler.editionSchedulerTask = undefined;
}

/** Stop and discard the currently-registered daily-processing cron task, if any. Safe to call when none is registered. */
export function unregisterDailySchedule(): void {
  const existing = globalForScheduler.editionDailySchedulerTask;
  if (!existing) return;
  existing.stop();
  void existing.destroy();
  globalForScheduler.editionDailySchedulerTask = undefined;
}

/**
 * (Re-)register the period-creation cron job from the current `Setting`
 * rows. Always stops any previously-registered task first, so this is the
 * single entry point for both "start at server boot" and "the admin just
 * changed the schedule."
 */
export async function registerSchedule(): Promise<void> {
  unregisterSchedule();

  const { cronExpr, enabled } = await getScheduleSettings();
  if (!enabled || !cronExpr) {
    console.log("[scheduler] Period-creation schedule is disabled or unset — not registering a cron job.");
    return;
  }
  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] Invalid period-creation cron expression "${cronExpr}" — not registering a cron job.`);
    return;
  }

  globalForScheduler.editionSchedulerTask = cron.schedule(cronExpr, runScheduledGeneration, {
    name: TASK_NAME,
    timezone: "UTC",
    noOverlap: true,
  });
  console.log(`[scheduler] Registered period-creation cron job "${cronExpr}" (UTC).`);
}

/** (Re-)register the daily-processing cron job from the current `Setting` rows — same shape as {@link registerSchedule}. */
export async function registerDailySchedule(): Promise<void> {
  unregisterDailySchedule();

  const { cronExpr, enabled } = await getDailyScheduleSettings();
  if (!enabled || !cronExpr) {
    console.log("[scheduler] Daily-processing schedule is disabled or unset — not registering a cron job.");
    return;
  }
  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] Invalid daily-processing cron expression "${cronExpr}" — not registering a cron job.`);
    return;
  }

  globalForScheduler.editionDailySchedulerTask = cron.schedule(cronExpr, runScheduledDailyProcessing, {
    name: DAILY_TASK_NAME,
    timezone: "UTC",
    // Several external API calls plus AI generation per day; never let two runs overlap.
    noOverlap: true,
  });
  console.log(`[scheduler] Registered daily-processing cron job "${cronExpr}" (UTC).`);
}

/** The next scheduled fire time for the currently-registered period-creation task, or `null` if none is registered. */
export function nextScheduledRun(): Date | null {
  return globalForScheduler.editionSchedulerTask?.getNextRun() ?? null;
}

/** The next scheduled fire time for the currently-registered daily-processing task, or `null` if none is registered. */
export function nextDailyScheduledRun(): Date | null {
  return globalForScheduler.editionDailySchedulerTask?.getNextRun() ?? null;
}

/**
 * Initialize both scheduled jobs once per server process. Called from
 * `instrumentation.ts`'s `register()` hook. Guarded by a `globalThis` flag
 * (same spirit as `@/lib/prisma`'s client caching) so Next.js dev-mode
 * module re-execution never double-registers the initial jobs — subsequent
 * schedule changes go through {@link registerSchedule}/{@link registerDailySchedule}
 * directly, which are themselves idempotent regardless of this guard.
 */
export async function initScheduler(): Promise<void> {
  if (globalForScheduler.editionSchedulerInitialized) return;
  globalForScheduler.editionSchedulerInitialized = true;
  await registerSchedule();
  await registerDailySchedule();
}
