/**
 * "Regenerate post" action for the admin day view (`../page.tsx`) — the
 * explicit way to force a day's post to be (re)written.
 *
 * Sibling of `../process/route.ts`, same fire-and-forget shape and for the same
 * reason: the work is minutes long (a `day-post` workflow run is 6-11 minutes
 * of LLM calls), so it runs in `after()` while the response redirects straight
 * back to the day page. `runTrackedDayPostGeneration` writes
 * `postStatus: "running"` before its first model call, so the redirected page
 * load already shows the run.
 *
 * The automatic trigger (chained onto day processing) deliberately skips a day
 * that already has a post; this route is the override — it passes `force`, and
 * the workflow's `(editionId, dayDate)` upsert replaces the post in place
 * rather than adding a second one. It is also the retry path for a post whose
 * run failed.
 */

import { after, type NextRequest } from "next/server";
import { dayBounds } from "@/lib/cadence";
import { flashRedirect } from "@/lib/flash";
import { runTrackedDayPostGeneration } from "@/lib/generation/day-post-trigger";
import { isPostRunStale } from "@/lib/generation/day-status";
import { prisma } from "@/lib/prisma";

/** `YYYY-MM-DD` -> UTC midnight `Date`, rejecting anything not a real calendar date. */
function parseDateParam(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; date: string }> },
) {
  const { editionId, date } = await params;
  const eId = Number(editionId);
  const dayPath = `/admin/editions/${eId}/day/${date}`;

  const requestedDate = parseDateParam(date);
  if (requestedDate === null) {
    return flashRedirect(request, `/admin/editions/${eId}/edit`, [
      { type: "error", text: `Invalid date "${date}".` },
    ]);
  }

  const edition = await prisma.edition.findUnique({ where: { id: eId } });
  if (!edition) {
    return flashRedirect(request, "/admin/editions", [{ type: "error", text: "Edition not found." }]);
  }

  const { periodStart: dayStart, periodEnd: dayEnd } = dayBounds(requestedDate);
  if (dayStart.getTime() < edition.periodStart.getTime() || dayStart.getTime() >= edition.periodEnd.getTime()) {
    return flashRedirect(request, dayPath, [
      { type: "error", text: "That day is outside this edition's period." },
    ]);
  }

  // A day with nothing stored has no post to write — `research-day` throws on
  // exactly this, and the wrapper's own guard would silently do nothing, which
  // from a button click reads as broken. Say so instead.
  const activityCount = await prisma.serviceActivity.count({
    where: { editionId: eId, timestamp: { gte: dayStart, lt: dayEnd } },
  });
  if (activityCount === 0) {
    return flashRedirect(request, dayPath, [
      {
        type: "warning",
        text: `No activity is stored for ${date}, so there is no post to write. Process the day first.`,
      },
    ]);
  }

  // ponytail: a plain read-then-start, not a conditional claim like
  // `claimDayProcessingRun` — two clicks inside the same second could start two
  // runs. Both would upsert the same `(editionId, dayDate)` article, so the
  // damage is a wasted LLM run rather than a duplicate post; tighten to a
  // conditional `updateMany` on `postStatus` if that ever actually happens.
  const run = await prisma.dayProcessingRun.findUnique({
    where: { editionId_date: { editionId: eId, date: dayStart } },
    select: { postStatus: true, postHeartbeatAt: true },
  });
  // ...unless that "running" row stopped heartbeating long ago, in which case
  // its process is gone and this is the only way to get the day unstuck — the
  // same reclaim `claimDayProcessingRun` does for the activity phase.
  if (run?.postStatus === "running" && !isPostRunStale(run.postStatus, run.postHeartbeatAt)) {
    return flashRedirect(request, dayPath, [
      { type: "info", text: `The post for ${date} is already being written.` },
    ]);
  }

  after(() => runTrackedDayPostGeneration(eId, dayStart, { force: true }));

  return flashRedirect(request, dayPath, [
    {
      type: "info",
      text: `Writing the post for ${date} — this takes several minutes and keeps running in the background; the page updates itself.`,
    },
  ]);
}
