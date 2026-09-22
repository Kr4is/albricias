/**
 * Manual "Process this day now" action for the admin day view
 * (`../page.tsx`) — calls `processOneDay` (`@/lib/generation/daily`)
 * directly for one specific `[dayStart, dayEnd)`, for iterating without
 * waiting on the daily cron. Sync (no `after()`): this is GitHub-only,
 * zero-LLM work for a single day, unlike the whole-edition "Generate"
 * pipeline those async routes defer — see `.../topic-candidates/[candidateId]/regenerate/route.ts`
 * for why that one needs deferral and this one doesn't.
 *
 * Deliberately never touches `Edition.lastProcessedDay` — `processOneDay`'s
 * own doc comment calls this route out by name as the reason it doesn't
 * advance the cursor itself: an admin re-running an arbitrary day (already
 * processed or not) must never rewind or corrupt what the daily cron
 * (`processYesterdayIfNeeded`) considers caught up.
 *
 * Which also means nothing here locks a day against being processed twice, so
 * the write it drives has to be idempotent rather than additive — it is; see
 * `replaceDayActivities` in `@/lib/generation/daily`. Repeat clicks replace
 * that day's rows instead of stacking duplicates.
 */

import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dayBounds } from "@/lib/cadence";
import { processOneDay } from "@/lib/generation/daily";
import { describeError, flashRedirect, type FlashMessage } from "@/lib/flash";

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

  const messages: FlashMessage[] = [];
  try {
    await processOneDay(edition.id, dayStart, dayEnd, messages);
  } catch (error) {
    messages.push({ type: "error", text: `Processing failed: ${describeError(error)}` });
  }
  if (messages.length === 0) {
    messages.push({ type: "success", text: `Processed ${date}.` });
  }

  return flashRedirect(request, dayPath, messages);
}
