/**
 * Next.js instrumentation hook — runs once when a new server instance starts,
 * before it accepts requests (see
 * `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`, current
 * for Next 16.3.4; `register()` has been stable since v15.0.0, so no
 * `next.config.ts` flag is needed to enable it).
 *
 * Used here (Phase A / scheduler) to register the edition-generation cron
 * job on server boot. The scheduler only touches Node APIs (Prisma,
 * node-cron), so it's only imported under the Node.js runtime — Next also
 * invokes `register()` under the Edge runtime, where none of this exists.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("@/lib/scheduler");
    await initScheduler();
  }
}
