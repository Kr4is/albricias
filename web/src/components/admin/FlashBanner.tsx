"use client";

/**
 * Renders the flash messages `@/lib/flash` reads back out of a page's
 * `searchParams`, styled exactly like the Jinja admin templates'
 * `get_flashed_messages()` blocks (`app/templates/admin/*.html`).
 *
 * Client component so it can survive its own URL cleanup. `messages` only
 * carries a value on the request that redirected here with `?flash=...`;
 * once mounted, this component strips those query params via
 * `router.replace()` so a browser back/forward doesn't re-show them. A naive
 * version reading straight from the `messages` prop would go blank the
 * moment that replace lands, because the next server render (this one included
 * — e.g. triggered by an unrelated `router.refresh()` elsewhere on the page)
 * sees an empty query string and re-renders with `messages: []`. Instead,
 * this component captures the first non-empty `messages` it sees into local
 * state and always renders from that capture.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FlashMessage, FlashType } from "@/lib/flash";

const STYLES: Record<FlashType, string> = {
  success: "border-green-600 bg-green-50 text-green-900",
  error: "border-red-600 bg-red-50 text-red-900",
  warning: "border-amber-500 bg-amber-50 text-amber-900",
  info: "border-blue-500 bg-blue-50 text-blue-900",
};

// Module-scope fallback for the captured messages, so a component remount
// (not just a re-render — e.g. a segment boundary resetting during a
// navigation) doesn't lose what was already shown to this browser tab.
// Only ever read/written client-side (guarded by `typeof window`): this
// module is also evaluated server-side, where it's a single instance shared
// across concurrent requests in the same Node process — writing to it during
// a server render would leak one admin's flash text into another request.
let capturedMessages: FlashMessage[] | null = null;

export default function FlashBanner({ messages }: { messages: FlashMessage[] }) {
  const router = useRouter();
  const [shown, setShown] = useState<FlashMessage[]>(() => {
    if (messages.length > 0) return messages;
    if (typeof window !== "undefined" && capturedMessages) return capturedMessages;
    return [];
  });
  // Tracks the last `messages` reference this component has reacted to, so
  // a later prop change (e.g. a fresh navigation to this same route with its
  // own `?flash=...`, without a full remount) can be captured too.
  const [prevMessages, setPrevMessages] = useState(messages);

  // Adjust state during render when a new, non-empty `messages` prop shows
  // up — the render-time pattern React recommends for "state derived from a
  // changing prop" instead of a useEffect, which would cause an extra,
  // avoidable commit here.
  if (messages !== prevMessages) {
    setPrevMessages(messages);
    if (messages.length > 0) setShown(messages);
  }

  // Keep the module-scope fallback in sync (effect-only, per the "reassign
  // outside variables in an effect, not during render" rule) so a later
  // remount of this component in the same browser tab — not just a
  // re-render — can still recover the last flash text shown.
  useEffect(() => {
    if (messages.length > 0) capturedMessages = messages;
  }, [messages]);

  // Strip `flash`/`flashType` from the URL once mounted, preserving any
  // other query params the page might have. Reads `window.location.search`
  // directly rather than `useSearchParams()`, which would force this
  // (otherwise pre-renderable) component into client-only rendering.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("flash") && !params.has("flashType")) return;
    params.delete("flash");
    params.delete("flashType");
    const query = params.toString();
    const cleanUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    router.replace(cleanUrl, { scroll: false });
    // Intentionally run once on mount: this is a one-time cleanup of the URL
    // this page was loaded with, not something that should re-run on every
    // `router`/`messages` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (shown.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {shown.map((message, index) => (
        <div
          key={index}
          className={`px-4 py-3 text-sm font-sans border-l-4 ${STYLES[message.type]}`}
        >
          {message.text}
        </div>
      ))}
    </div>
  );
}
