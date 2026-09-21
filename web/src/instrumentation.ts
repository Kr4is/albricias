/**
 * Next.js instrumentation hook — runs once when a new server instance starts,
 * before it accepts requests (see
 * `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`, current
 * for Next 16.3.4; `register()` has been stable since v15.0.0, so no
 * `next.config.ts` flag is needed to enable it).
 *
 * Two Node-only startup tasks (both only touch Node APIs — Prisma,
 * node-cron — so both stay behind the runtime check; Next also invokes
 * `register()` under the Edge runtime, where neither would work):
 *   - Register the edition-generation cron job (Phase A / scheduler).
 *   - Recover any edition a previous server process left stuck in
 *     `generationStatus: "running"` when it died mid-generation — see
 *     `recoverStuckGenerations()`'s doc comment in `@/lib/generation`.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("@/lib/scheduler");
    await initScheduler();

    const { recoverStuckGenerations } = await import("@/lib/generation");
    await recoverStuckGenerations();
  }
}
