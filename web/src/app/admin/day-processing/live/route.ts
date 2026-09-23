/**
 * Live day-processing status — Server-Sent Events.
 *
 * Same shape as `admin/editions/[editionId]/live/route.ts` (poll Prisma every
 * 500ms, emit only on change, 20-minute *inactivity* ceiling), applied to
 * `DayProcessingRun` rows instead of `Edition.generationStatus`. Not under an
 * `[editionId]` segment because the admin dashboard watches days across
 * several editions at once, and one connection diffing N rows beats N
 * connections diffing one each.
 *
 * Watched days arrive as `?days=<editionId>:<YYYY-MM-DD>,...` — exactly the
 * days the requesting page currently renders as `processing`. Missing/empty,
 * or every watched day already settled, gets an immediate `done`: nothing to
 * watch, no poll loop (mirrors the existing route's non-running short-circuit).
 *
 * Like that route, this one never renders HTML and must not import React or
 * `react-dom/server` — route handlers share the App Router's RSC compilation
 * layer, where `react-dom/server` throws on import. Auth: none needed, already
 * covered centrally by the `/admin/:path*` matcher in `web/src/proxy.ts`.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDateInputValue } from "@/lib/date-input";

const POLL_INTERVAL_MS = 500;
/** Inactivity ceiling, not a total-duration one — reset on every real change. */
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
/** A page watches a handful of days; this only stops a hand-written URL from building a pathological `OR`. */
const MAX_WATCHED_DAYS = 200;

interface WatchedDay {
  editionId: number;
  dateStr: string;
  date: Date;
}

/** One watched day as the client sees it. `status: null` = no run row (any more). */
interface DaySnapshot {
  editionId: number;
  dateStr: string;
  status: string | null;
  finishedAt: string | null;
  error: string | null;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `?days=7:2026-09-13,7:2026-09-14` — unparseable or duplicate pairs are dropped, not an error. */
function parseWatchedDays(raw: string | null): WatchedDay[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const days: WatchedDay[] = [];
  for (const pair of raw.split(",")) {
    const [rawId, rawDate] = pair.split(":");
    const editionId = Number(rawId);
    const date = parseDateInputValue(rawDate);
    if (!Number.isInteger(editionId) || !date) continue;
    const key = `${editionId}:${rawDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    days.push({ editionId, dateStr: rawDate, date });
    if (days.length >= MAX_WATCHED_DAYS) break;
  }
  return days;
}

/** Always one snapshot per watched day, in the requested order — so `JSON.stringify` is a valid diff. */
async function readSnapshots(days: WatchedDay[]): Promise<DaySnapshot[]> {
  const rows = await prisma.dayProcessingRun.findMany({
    where: { OR: days.map(({ editionId, date }) => ({ editionId, date })) },
    select: { editionId: true, date: true, status: true, finishedAt: true, error: true },
  });
  const byKey = new Map(
    rows.map((row) => [`${row.editionId}:${row.date.toISOString().slice(0, 10)}`, row]),
  );
  return days.map(({ editionId, dateStr }) => {
    const row = byKey.get(`${editionId}:${dateStr}`);
    return {
      editionId,
      dateStr,
      status: row?.status ?? null,
      finishedAt: row?.finishedAt?.toISOString() ?? null,
      error: row?.error ?? null,
    };
  });
}

/** Every watched day reached `done`/`failed`, or lost its row entirely. */
function allSettled(snapshots: DaySnapshot[]): boolean {
  return snapshots.every((day) => day.status !== "running");
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export async function GET(request: NextRequest) {
  const days = parseWatchedDays(request.nextUrl.searchParams.get("days"));
  if (days.length === 0) {
    return new Response(sseEvent("done", { days: [] }), { headers: SSE_HEADERS });
  }

  const initial = await readSnapshots(days);
  // Reconnect (reload, second tab, `EventSource` retry) after the watched days
  // already finished: reply `done` instead of opening a 20-minute poll over
  // rows that aren't changing anymore.
  if (allSettled(initial)) {
    return new Response(sseEvent("done", { days: initial }), { headers: SSE_HEADERS });
  }

  let lastSent = JSON.stringify(initial);
  let lastChangeAt = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseEvent("snapshot", { days: initial })));

      let closed = false;
      const stop = () => {
        if (closed) return;
        closed = true;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed — nothing left to do.
        }
      };

      timer = setInterval(() => {
        if (busy || closed) return;
        busy = true;
        void (async () => {
          try {
            if (request.signal.aborted) {
              stop();
              return;
            }

            const current = await readSnapshots(days);
            // The abort listener (or a previous tick) may have closed the
            // stream while this read was in flight — an enqueue on a closed
            // controller throws.
            if (closed) return;

            const serialized = JSON.stringify(current);
            const changed = serialized !== lastSent;
            if (changed) lastChangeAt = Date.now();

            if (allSettled(current)) {
              lastSent = serialized;
              controller.enqueue(encoder.encode(sseEvent("done", { days: current })));
              stop();
              return;
            }

            if (changed) {
              lastSent = serialized;
              controller.enqueue(encoder.encode(sseEvent("update", { days: current })));
              return;
            }

            if (Date.now() - lastChangeAt > INACTIVITY_TIMEOUT_MS) {
              controller.enqueue(encoder.encode(sseEvent("timeout", { days: current })));
              stop();
            }
          } finally {
            busy = false;
          }
        })();
      }, POLL_INTERVAL_MS);

      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
