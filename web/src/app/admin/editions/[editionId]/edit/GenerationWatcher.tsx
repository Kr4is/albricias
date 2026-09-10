/**
 * Live "generation in progress" banner for `/admin/editions/[id]/edit`.
 *
 * Sole owner of the banner (see the plan's "Decisión de renderizado" v4 and
 * round-5 fix): `edit/page.tsx` no longer renders one itself. This component
 * starts from the `generationProgress` prop (so the banner is correct on
 * first paint, before any SSE event arrives), then opens an `EventSource`
 * against `/admin/editions/[id]/live` and reacts to its `snapshot` / `update`
 * / `done` / `timeout` events — never rendering HTML from the server-sent
 * payloads itself, only updating this banner's own text and calling
 * `router.refresh()` so Next re-renders `edit/page.tsx` (which owns the
 * actual article markup) server-side in the normal way.
 *
 * `router.refresh()` is wrapped in a `useTransition` so the pending state
 * doubles as the concurrency guard the plan asks for: if events arrive
 * faster than a refresh commits, only one extra refresh is queued instead of
 * piling one up per event.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type GenerationSectionStatus =
  | "pending"
  | "writing"
  | "done"
  | "failed"
  | "aborted";

export interface GenerationSection {
  category: string;
  status: GenerationSectionStatus;
}

/** Parsed shape of `Edition.generationProgress` — see `prisma/schema.prisma`. */
export interface GenerationProgress {
  sourceProgress: Record<string, string>;
  totalSections: number;
  completedSections: number;
  sections: GenerationSection[];
}

/** JSON payload sent by every event on `/admin/editions/[id]/live`. */
interface LiveEventPayload {
  generationStatus: string;
  generationProgress: GenerationProgress | string | null;
  activityCount: number;
  articleCount: number;
}

export interface GenerationWatcherProps {
  editionId: number;
  generationProgress: GenerationProgress | null;
}

/** `generationProgress` may arrive already parsed or (defensively) as a raw JSON string. */
function normalizeProgress(
  value: GenerationProgress | string | null | undefined,
): GenerationProgress | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as GenerationProgress;
    } catch {
      return null;
    }
  }
  return value;
}

function parseEventPayload(raw: string): LiveEventPayload | null {
  try {
    return JSON.parse(raw) as LiveEventPayload;
  } catch {
    return null;
  }
}

export default function GenerationWatcher({
  editionId,
  generationProgress: initialProgress,
}: GenerationWatcherProps) {
  const router = useRouter();
  const [progress, setProgress] = useState<GenerationProgress | null>(initialProgress);
  const [finished, setFinished] = useState(false);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const refreshQueuedRef = useRef(false);
  const sourceRef = useRef<EventSource | null>(null);

  function requestRefresh() {
    if (isRefreshing) {
      refreshQueuedRef.current = true;
      return;
    }
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  // Flush a refresh that arrived while the previous one was still in flight.
  useEffect(() => {
    if (!isRefreshing && refreshQueuedRef.current) {
      refreshQueuedRef.current = false;
      startRefreshTransition(() => {
        router.refresh();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRefreshing]);

  useEffect(() => {
    function connect() {
      const source = new EventSource(`/admin/editions/${editionId}/live`);
      sourceRef.current = source;

      source.addEventListener("snapshot", (event) => {
        const payload = parseEventPayload((event as MessageEvent).data);
        if (!payload) return;
        setProgress(normalizeProgress(payload.generationProgress));
        if (payload.generationStatus !== "running") {
          setFinished(true);
          source.close();
        }
      });

      source.addEventListener("update", (event) => {
        const payload = parseEventPayload((event as MessageEvent).data);
        if (!payload) return;
        setProgress(normalizeProgress(payload.generationProgress));
        requestRefresh();
      });

      const finish = (event: Event) => {
        const payload = parseEventPayload((event as MessageEvent).data);
        if (payload) setProgress(normalizeProgress(payload.generationProgress));
        requestRefresh();
        setFinished(true);
        source.close();
      };
      source.addEventListener("done", finish);
      source.addEventListener("timeout", finish);
    }

    connect();

    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      sourceRef.current?.close();
      setFinished(false);
      connect();
      requestRefresh();
    }
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      sourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionId]);

  if (finished) return null;

  const total = progress?.totalSections ?? 0;
  const completed = progress?.completedSections ?? 0;
  // Sections are written concurrently and settle independently, so a failure
  // says nothing about its siblings: count every unsuccessful section, and
  // word it as "these ones" rather than "everything after the first failure".
  const failedCount =
    progress?.sections.filter((s) => s.status === "aborted" || s.status === "failed").length ?? 0;

  return (
    <div
      id="generation-in-progress"
      className="flex items-center gap-3 bg-purple-50 border border-purple-200 p-4 mb-8 text-xs font-sans text-purple-900"
    >
      <span className="material-icons text-purple-600 animate-spin">autorenew</span>
      <p className="flex-1">
        {total > 0 ? (
          <>
            Writing… {completed} of {total} sections ready. Activity and
            articles will appear below as they&apos;re created.
          </>
        ) : (
          <>
            Generating this edition — fetching activity and writing articles
            now. Activity and articles will appear below as they&apos;re
            created.
          </>
        )}
        {failedCount > 0 && (
          <span className="block mt-1 text-amber-700 font-bold">
            {failedCount} section{failedCount === 1 ? "" : "s"} could not be
            generated — the remaining ones are unaffected and the edition keeps
            every article already written.
          </span>
        )}
      </p>
    </div>
  );
}
