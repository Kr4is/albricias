/**
 * In-process cron scheduler for autonomous edition generation (Phase A).
 *
 * Reads two new `Setting` rows (the existing generic key/value model, no
 * schema change) — `scheduleCron` (a cron expression) and `scheduleEnabled`
 * (`"true"`/`"false"`) — and, when enabled, registers a `node-cron` job that
 * fires on that schedule. On each fire it computes the *current* period from
 * the active cadence (`getCadence()` / `currentPeriodBounds()`,
 * `@/lib/cadence`) and calls the same `runEditionGeneration()` pipeline the
 * manual "Generate edition" button uses (`@/lib/generation`) — which already
 * no-ops (returns `{ status: "exists" }`) if an edition for that period was
 * already created, manually or by a previous scheduled run, so this never
 * crashes or duplicates.
 *
 * The registered task is cached on `globalThis`, the same pattern
 * `@/lib/prisma` uses for its `PrismaClient`, so a Next.js dev-mode module
 * re-execution (Fast Refresh) doesn't leak a second running cron task.
 * `registerSchedule()` always stops/destroys whatever task is currently
 * cached before creating a new one, so it is safe to call again at runtime
 * (e.g. right after the admin saves a new schedule) to pick up the change
 * without a server restart.
 */

import cron, { type ScheduledTask } from "node-cron";
import { currentPeriodBounds, getCadence } from "@/lib/cadence";
import { runEditionGeneration } from "@/lib/generation";
import { prisma } from "@/lib/prisma";

const SCHEDULE_CRON_KEY = "scheduleCron";
const SCHEDULE_ENABLED_KEY = "scheduleEnabled";
const TASK_NAME = "edition-generation";

/** Default cron expression offered in the admin UI before anything is saved. */
export const DEFAULT_SCHEDULE_CRON = "0 6 * * 1"; // Mondays at 06:00 UTC

const globalForScheduler = globalThis as unknown as {
  editionSchedulerTask?: ScheduledTask;
  editionSchedulerInitialized?: boolean;
};

export interface ScheduleSettings {
  cronExpr: string | null;
  enabled: boolean;
}

/** Read the current schedule settings from the `Setting` table. */
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

/** Persist the schedule settings. Does not itself (re-)register the job — call {@link registerSchedule} after. */
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

/** One fire of the scheduled job: current-period generation, skipping if it already exists. */
async function runScheduledGeneration(): Promise<void> {
  try {
    const cadence = await getCadence();
    const period = currentPeriodBounds(cadence);
    const outcome = await runEditionGeneration(cadence, period.periodStart, period.periodEnd);

    if (outcome.status === "exists") {
      console.log(
        `[scheduler] Edition for the current ${cadence} period already exists (id ${outcome.edition.id}) — skipping scheduled generation.`,
      );
      return;
    }

    console.log(
      `[scheduler] Scheduled generation complete: edition ${outcome.edition.id} ` +
        `("${outcome.edition.title}"), ${outcome.fetchedCount - outcome.spotifyFetched} GitHub/blog events, ` +
        `${outcome.spotifyFetched} Spotify items, ${outcome.generatedCount} AI-generated articles.`,
    );
  } catch (error) {
    // A scheduled run must never crash the server process — log and wait for the next fire.
    console.error("[scheduler] Scheduled edition generation failed:", error);
  }
}

/** Stop and discard the currently-registered cron task, if any. Safe to call when none is registered. */
export function unregisterSchedule(): void {
  const existing = globalForScheduler.editionSchedulerTask;
  if (!existing) return;
  existing.stop();
  void existing.destroy();
  globalForScheduler.editionSchedulerTask = undefined;
}

/**
 * (Re-)register the cron job from the current `Setting` rows. Always stops
 * any previously-registered task first, so this is the single entry point
 * for both "start at server boot" and "the admin just changed the schedule."
 */
export async function registerSchedule(): Promise<void> {
  unregisterSchedule();

  const { cronExpr, enabled } = await getScheduleSettings();
  if (!enabled || !cronExpr) {
    console.log("[scheduler] Edition-generation schedule is disabled or unset — not registering a cron job.");
    return;
  }
  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] Invalid cron expression "${cronExpr}" — not registering a cron job.`);
    return;
  }

  globalForScheduler.editionSchedulerTask = cron.schedule(cronExpr, runScheduledGeneration, {
    name: TASK_NAME,
    timezone: "UTC",
    // Generation makes several external API calls; never let two runs overlap.
    noOverlap: true,
  });
  console.log(`[scheduler] Registered edition-generation cron job "${cronExpr}" (UTC).`);
}

/** The next scheduled fire time for the currently-registered task, or `null` if none is registered. */
export function nextScheduledRun(): Date | null {
  return globalForScheduler.editionSchedulerTask?.getNextRun() ?? null;
}

/**
 * Initialize the scheduler once per server process. Called from
 * `instrumentation.ts`'s `register()` hook. Guarded by a `globalThis` flag
 * (same spirit as `@/lib/prisma`'s client caching) so Next.js dev-mode
 * module re-execution never double-registers the initial job — subsequent
 * schedule changes go through {@link registerSchedule} directly, which is
 * itself idempotent regardless of this guard.
 */
export async function initScheduler(): Promise<void> {
  if (globalForScheduler.editionSchedulerInitialized) return;
  globalForScheduler.editionSchedulerInitialized = true;
  await registerSchedule();
}
