/**
 * Next.js instrumentation hook — runs once when a new server instance starts,
 * before it accepts requests (see
 * `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`, current
 * for Next 16.3.4; `register()` has been stable since v15.0.0, so no
 * `next.config.ts` flag is needed to enable it).
 *
 * Three Node-only startup tasks (all only touch Node APIs — Prisma,
 * node-cron — so all stay behind the runtime check; Next also invokes
 * `register()` under the Edge runtime, where none of them would work):
 *   - Register the edition-generation cron job (Phase A / scheduler).
 *   - Recover any edition a previous server process left stuck in
 *     `generationStatus: "running"` when it died mid-generation — see
 *     `recoverStuckGenerations()`'s doc comment in `@/lib/generation`.
 *   - Self-heal a missing current-period edition — see
 *     `ensureCurrentEditionExists()` below.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("@/lib/scheduler");
    await initScheduler();

    const { recoverStuckGenerations } = await import("@/lib/generation");
    await recoverStuckGenerations();

    void ensureCurrentEditionExists();
  }
}

/**
 * Self-healing bootstrap: make sure the current period's `Edition` exists
 * and is caught up through yesterday, without waiting for the weekly
 * period-creation cron or a manual "Generate edition" click.
 *
 * `createDraftEdition` is idempotent on `(cadence, periodStart)`, so it's
 * safe to call unconditionally on every boot — it either creates the
 * current period's draft or returns the existing one.
 *
 * Yesterday is then processed against whichever edition's period actually
 * *contains* yesterday, which on the first day of a period is not the
 * edition just ensured above: booting on Apr 1, yesterday is Mar 31 and
 * belongs to the March edition. Handing it to April's edition correctly
 * no-ops (`processYesterdayIfNeeded` never processes a day before its
 * edition's `periodStart` — that clamp keeps a new edition from ingesting
 * the previous period's activity), which is exactly how every period's last
 * day used to be dropped: nothing else ever handed the outgoing edition its
 * own final day. `findEditionForDay` routes it to the right one. The
 * scheduler's daily cron has the same fix for the same reason.
 *
 * No "is this needed" check here beyond that: `processYesterdayIfNeeded`
 * already no-ops when the edition is caught up, and its lock is claimed
 * atomically, so a boot landing on the cron's fire time can't double-process.
 *
 * Fire-and-forget from `register()` (not awaited) so a slow or failing
 * check never delays or crashes server boot; every error is caught and
 * logged here rather than propagating.
 */
async function ensureCurrentEditionExists(): Promise<void> {
  try {
    const { currentPeriodBounds, getCadence } = await import("@/lib/cadence");
    const { createDraftEdition } = await import("@/lib/generation");
    const { findEditionForDay, processYesterdayIfNeeded, yesterdayUtc } = await import(
      "@/lib/generation/daily"
    );

    const cadence = await getCadence();
    const { periodStart, periodEnd } = currentPeriodBounds(cadence);
    const outcome = await createDraftEdition(cadence, periodStart, periodEnd);

    if (outcome.status === "started") {
      console.log(
        `[instrumentation] Created draft edition ${outcome.edition.id} ("${outcome.edition.title}") for the current ${cadence} period on boot.`,
      );
    }

    // The edition just ensured already covers yesterday in the common case
    // (any day but a period's first) — reuse that row instead of re-querying.
    const yesterday = yesterdayUtc();
    const current = outcome.edition;
    const owner =
      yesterday.getTime() >= current.periodStart.getTime() && yesterday.getTime() < current.periodEnd.getTime()
        ? current
        : await findEditionForDay(yesterday);

    if (!owner) {
      console.log(
        `[instrumentation] No edition covers ${yesterday.toISOString().slice(0, 10)} — nothing to process on boot.`,
      );
      return;
    }
    if (owner.id !== current.id) {
      console.log(
        `[instrumentation] Yesterday (${yesterday.toISOString().slice(0, 10)}) belongs to the outgoing edition ${owner.id} ("${owner.title}") — processing it there.`,
      );
    }
    await processYesterdayIfNeeded(owner);
  } catch (error) {
    // Boot must never crash because this self-healing check failed — log
    // and let the daily cron or a manual click pick up the slack.
    console.error("[instrumentation] ensureCurrentEditionExists failed:", error);
  }
}
