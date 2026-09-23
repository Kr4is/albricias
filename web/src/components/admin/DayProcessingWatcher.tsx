/**
 * Live refresh for pages that render day-processing status (the admin
 * dashboard's day grid, the single-day view).
 *
 * Same shape as `admin/editions/[id]/edit/GenerationWatcher.tsx`, minus the
 * banner: the day cards and status badges already show their own state, so
 * this component's whole job is to open an `EventSource` against
 * `/admin/day-processing/live` and call `router.refresh()` when the server
 * says something changed. It renders nothing, ever.
 *
 * `days` is the set of days the page currently renders as `processing` —
 * known server-side at render time, so no extra fetch to discover it. Empty
 * means no connection at all: there is nothing to watch. Each refresh
 * re-renders the page with a smaller `days` set as days settle, which
 * reconnects to the narrower set and eventually to nothing.
 *
 * `router.refresh()` is wrapped in a `useTransition` so the pending state
 * doubles as a concurrency guard: events arriving faster than a refresh
 * commits queue exactly one extra refresh, not one per event.
 */

"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** One watched day: an edition and a `YYYY-MM-DD` UTC calendar day. */
export interface WatchedDay {
  editionId: number;
  dateStr: string;
}

export interface DayProcessingWatcherProps {
  days: WatchedDay[];
}

export default function DayProcessingWatcher({ days }: DayProcessingWatcherProps) {
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const refreshQueuedRef = useRef(false);
  const sourceRef = useRef<EventSource | null>(null);

  // The effect's dependency, not `days` itself — a fresh array on every render
  // would reconnect on every render.
  const daysParam = days.map(({ editionId, dateStr }) => `${editionId}:${dateStr}`).join(",");

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
    if (!daysParam) return;

    function connect() {
      const source = new EventSource(
        `/admin/day-processing/live?days=${encodeURIComponent(daysParam)}`,
      );
      sourceRef.current = source;

      source.addEventListener("update", () => requestRefresh());

      const finish = () => {
        requestRefresh();
        source.close();
      };
      source.addEventListener("done", finish);
      source.addEventListener("timeout", finish);
    }

    connect();

    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      sourceRef.current?.close();
      connect();
      requestRefresh();
    }
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      sourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysParam]);

  return null;
}
