/**
 * Backdrop + panel for an intercepted route rendered as a modal (see
 * `admin/@modal/(.)settings/page.tsx`). Closing — the backdrop, the ✕, or
 * Escape — calls `router.back()` rather than navigating to a fixed URL:
 * that's what makes it dismiss back to wherever the admin actually came
 * from, the same way browser-native modal-ish UI behaves.
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Modal({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") router.back();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={() => router.back()}
    >
      <div
        className="w-full max-w-4xl bg-paper border-2 border-ink shadow-2xl my-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b-4 border-double border-ink px-6 py-4">
          <h2 className="font-masthead text-3xl text-ink">{title}</h2>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            className="p-1.5 text-stone-500 hover:text-ink transition-colors"
          >
            <span className="material-icons">close</span>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
