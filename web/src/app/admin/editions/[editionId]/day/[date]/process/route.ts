/**
 * Manual "Process this day now" action for the admin day view
 * (`../page.tsx`) — one specific `[dayStart, dayEnd)`, for iterating without
 * waiting on the daily cron.
 *
 * Fire-and-forget, the same shape as `admin/editions/generate/route.ts`: the
 * day's `DayProcessingRun` row is claimed synchronously *before* the response,
 * then `after()` runs the actual 15-30s of GitHub calls. That ordering is what
 * makes a reload immediately after clicking show `"processing"` rather than
 * looking like nothing happened — and what stops a reload from aborting the
 * work, which is exactly what the old blocking `await processOneDay(...)` did.
 *
 * Deliberately never touches `Edition.lastProcessedDay` — `processOneDay`'s
 * own doc comment calls this route out by name as the reason it doesn't
 * advance the cursor itself: an admin re-running an arbitrary day (already
 * processed or not) must never rewind or corrupt what the daily cron
 * (`processYesterdayIfNeeded`) considers caught up.
 *
 * The claim does lock a day against a second concurrent run of itself, but the
 * write it drives is idempotent anyway — see `replaceDayActivities` in
 * `@/lib/generation/daily`. Repeat clicks replace that day's rows instead of
 * stacking duplicates.
 */

import { after, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dayBounds } from "@/lib/cadence";
import { claimDayProcessingRun, runTrackedDayProcessing } from "@/lib/generation/daily";
import { flashRedirect } from "@/lib/flash";

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

  // Only a day that is already over can be processed — the same rule the day
  // view's button follows, enforced here too since the form isn't the only way
  // to reach this route. A day still in progress would be fetched incomplete
  // and then look processed.
  const today = dayBounds(new Date()).periodStart;
  if (dayStart.getTime() >= today.getTime()) {
    return flashRedirect(request, dayPath, [
      {
        type: "error",
        text: "That day isn't over yet — only a completed day can be processed. Daily processing picks it up after 00:00 UTC.",
      },
    ]);
  }

  const claim = await claimDayProcessingRun(edition.id, dayStart);
  if (!claim.claimed) {
    return flashRedirect(request, dayPath, [
      { type: "info", text: `${date} is already being processed.` },
    ]);
  }

  // `runTrackedDayProcessing` settles the run row itself and never throws, so
  // there is nothing to catch here — and nothing listening either, the
  // response below is already gone by the time this runs.
  after(() => runTrackedDayProcessing(edition.id, dayStart, dayEnd, claim.runId!));

  return flashRedirect(request, dayPath, [
    {
      type: "info",
      text: `Processing ${date} — this keeps running in the background; reload to see it finish.`,
    },
  ]);
}
