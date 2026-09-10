/**
 * Live generation progress — Server-Sent Events.
 *
 * Replaces the old `setInterval(() => location.reload(), 3000)` full-page
 * poll (see `web/src/app/admin/editions/[editionId]/edit/GenerationWatcher.tsx`,
 * the sole client of this route). Per the plan's "Decisión de renderizado"
 * (v4): this endpoint never renders HTML and must never import React or
 * `react-dom/server` — route handlers share the App Router's RSC compilation
 * layer, and `react-dom/server` throws on import under that condition
 * (verified against `node_modules/react-dom/server.react-server.js` and
 * `node_modules/next/dist/lib/constants.js`). It only reads `Edition` /
 * `ServiceActivity` / `Article` counts from Prisma and sends plain JSON;
 * `GenerationWatcher` is the one that turns that JSON into a `router.refresh()`
 * and its own banner text.
 *
 * Auth: none needed here — already covered centrally by the `/admin/:path*`
 * matcher in `web/src/proxy.ts`.
 *
 * "Progress-in-DB, poll-in-handler" (Option B in the plan): the generation
 * pipeline (`populateEditionDraft`/`generateEditionDraft`,
 * `web/src/lib/generation/index.ts`) only ever writes `Edition.generationStatus`
 * / `generationProgress` — it knows nothing about SSE or who's watching. This
 * handler polls that same state every 500ms and only emits an `update` event
 * when something actually changed, so a reconnect (page reload, new tab)
 * "catches up" for free by just reading the DB, no in-memory event log to
 * replay.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const POLL_INTERVAL_MS = 500;
/**
 * Inactivity ceiling, not a total-connection-duration ceiling (round-5 fix):
 * resets every time a real change is detected, so a slow-but-still-progressing
 * generation (a local Ollama model can take a while per article) is never cut
 * off — only a generation that has genuinely stalled for 20 minutes is.
 */
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;

interface Snapshot {
  generationStatus: string;
  generationProgress: string | null;
  activityCount: number;
  articleCount: number;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function readSnapshot(editionId: number): Promise<Snapshot | null> {
  const [edition, activityCount, articleCount] = await Promise.all([
    prisma.edition.findUnique({
      where: { id: editionId },
      select: { generationStatus: true, generationProgress: true },
    }),
    prisma.serviceActivity.count({ where: { editionId } }),
    prisma.article.count({ where: { editionId } }),
  ]);
  if (!edition) return null;
  return {
    generationStatus: edition.generationStatus,
    generationProgress: edition.generationProgress,
    activityCount,
    articleCount,
  };
}

function hasChanged(a: Snapshot, b: Snapshot): boolean {
  return (
    a.generationProgress !== b.generationProgress ||
    a.activityCount !== b.activityCount ||
    a.articleCount !== b.articleCount
  );
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId: rawId } = await params;
  const editionId = Number(rawId);
  if (!Number.isInteger(editionId)) {
    return new Response("Not found", { status: 404 });
  }

  const initial = await readSnapshot(editionId);
  if (!initial) {
    return new Response("Not found", { status: 404 });
  }

  // Reconnection (browser tab reload, `EventSource` auto-retry, a second tab)
  // after generation already finished: reply with `done` immediately instead
  // of opening a fresh 20-minute inactivity poll over an edition that isn't
  // changing anymore.
  if (initial.generationStatus !== "running") {
    return new Response(sseEvent("done", { generationStatus: initial.generationStatus }), {
      headers: SSE_HEADERS,
    });
  }

  let lastSent = initial;
  let lastChangeAt = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseEvent("snapshot", lastSent)));

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

            const current = await readSnapshot(editionId);
            // The abort listener (or a previous tick) may have closed the
            // stream while this read was in flight — an enqueue on a closed
            // controller throws.
            if (closed) return;
            if (!current) {
              stop();
              return;
            }

            const changed = hasChanged(current, lastSent);
            if (changed) lastChangeAt = Date.now();

            if (current.generationStatus !== "running") {
              lastSent = current;
              controller.enqueue(encoder.encode(sseEvent("done", current)));
              stop();
              return;
            }

            if (changed) {
              lastSent = current;
              controller.enqueue(encoder.encode(sseEvent("update", current)));
              return;
            }

            if (Date.now() - lastChangeAt > INACTIVITY_TIMEOUT_MS) {
              controller.enqueue(encoder.encode(sseEvent("timeout", current)));
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
