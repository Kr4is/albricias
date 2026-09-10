"use client";

/**
 * Generic bfcache handling, mounted once from `NewspaperShell.tsx` so every
 * page gets it. When a page is restored from the back/forward cache
 * (`event.persisted`), no fresh request happens — anything driven by the
 * last server render (flash state included) can be stale. A plain
 * `router.refresh()` re-fetches the current route's Server Component tree
 * without a full reload; no DOM manipulation here.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FlashBfcacheRefresh() {
  const router = useRouter();

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) router.refresh();
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [router]);

  return null;
}
