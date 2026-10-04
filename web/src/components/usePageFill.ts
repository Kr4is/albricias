"use client";

/**
 * Makes the rendered front page read as a finished one — filled, and with
 * every set of side-by-side columns ending on the same line — measured,
 * not guessed from an article count, and never by inventing content.
 *
 * Once generation is done and the page's images and fonts have settled
 * (and again after a window resize), one pass runs, in order:
 *   1. Fill: if the page is shorter than `TARGET_VIEWPORTS` × the viewport,
 *      `--issue-scale` (see `.issue-page` in globals.css) rises in
 *      `SCALE_STEP`s up to `MAX_SCALE`.
 *   2. Fold: with every secondary story on V4's side rail, each story is
 *      measured once and `planFold` works out how many fit beside the lead
 *      (`onFold`); the rest move to the balanced band below. A safety loop
 *      then drops one more story while the rail still runs past the lead.
 *   3. Level: `levelFlows` tunes each multi-column flow's type size so its
 *      columns end on the same line; `balanceColumns` evens out the
 *      side-by-side columns — a short column's type grows a little, then
 *      the rest of its shortfall becomes space between its stories.
 *   4. If the page is still short, or levelling had to leave holes wider
 *      than `MAX_SPREAD_GAP_PX`, one switch to a space-generous layout
 *      with no side-by-side columns (`pickSpaciousLayout`) — unless the
 *      visitor picked a layout themselves or it already is one. The new
 *      layout re-runs this same pass.
 * Every step only moves one way, so the pass settles instead of
 * oscillating. A page that's already long enough is never compacted — a
 * busy period simply runs long, like a real paper.
 *
 * Scales and balancing are written straight onto the DOM, not React state:
 * they're pure presentation knobs, and measuring right after each step
 * needs the DOM updated immediately. The placement is the exception — it
 * moves stories between React-rendered containers, so it's a prop the
 * pass sets and then waits a frame for.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { balanceColumns, foldOverflows, levelFlows, MAX_SPREAD_GAP_PX, planFold, resetBalance } from "@/lib/balance";
import { isSpaciousLayout, pickSpaciousLayout, type LayoutIndex } from "@/lib/layout";

/** Minimum page height, in viewport heights — tuned by eye, adjust here. */
const TARGET_VIEWPORTS = 1.6;
const SCALE_STEP = 0.1;
const MAX_SCALE = 1.3;
/** Below this width every layout stacks into one column, which is long anyway. */
const MIN_VIEWPORT_WIDTH = 1024;
/** Lazy images far below the fold never load; don't wait on them forever. */
const IMAGE_SETTLE_TIMEOUT_MS = 2500;

function imagesSettled(node: HTMLElement): Promise<void> {
  const pending = [...node.querySelectorAll("img")]
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_SETTLE_TIMEOUT_MS));
  return Promise.race([Promise.all(pending).then(() => undefined), timeout]);
}

/** A fold with more steps than this is a bug, not a page — stop rather than loop. */
const MAX_FOLD_STEPS = 40;
const RESIZE_DEBOUNCE_MS = 250;

/** Two frames — lets a just-removed failed image's figure, or a just-committed re-render, reach the layout before measuring. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function usePageFill({
  ref,
  active,
  layout,
  total,
  allowRepick,
  onRepick,
  onFold,
}: {
  ref: RefObject<HTMLElement | null>;
  /** Generation finished — nothing is measured while text is still streaming in. */
  active: boolean;
  layout: LayoutIndex | null;
  total: number;
  /** `false` once the visitor has chosen a layout by hand — their choice is never overridden. */
  allowRepick: boolean;
  onRepick: (layout: LayoutIndex) => void;
  /** Sets the layout's `fold` (`null` = every secondary story on the rail). */
  onFold: (fold: number | null) => void;
}) {
  const repicked = useRef(false);
  // Read through a ref so a new callback identity each render doesn't re-trigger the pass.
  const onRepickRef = useRef(onRepick);
  const onFoldRef = useRef(onFold);
  useEffect(() => {
    onRepickRef.current = onRepick;
    onFoldRef.current = onFold;
  });

  // Column widths change with the window, and every measurement with them.
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setResizeTick((tick) => tick + 1), RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!active) repicked.current = false;
  }, [active]);

  useEffect(() => {
    const node = ref.current;
    if (!active || !node || layout === null) return;
    let cancelled = false;
    node.style.setProperty("--issue-scale", "1");
    resetBalance(node);
    delete node.dataset.settled;

    (async () => {
      // Marks the end of a pass — what `scripts/check-layouts.ts` waits for
      // before measuring. Not set when the pass switched layouts: the new
      // layout re-runs it.
      let switched = false;
      try {
        switched = await fill(node, layout);
      } finally {
        if (!cancelled && !switched) node.dataset.settled = "1";
      }
    })();

    /** Runs the pass; `true` when it ended by switching layout. */
    async function fill(node: HTMLElement, layout: LayoutIndex): Promise<boolean> {
      // Start from every story above the fold — a previous pass's fold was
      // measured for another layout or window width.
      onFoldRef.current(null);
      await Promise.all([imagesSettled(node), document.fonts?.ready]);
      await nextPaint();
      if (cancelled || window.innerWidth < MIN_VIEWPORT_WIDTH) return false;

      const target = window.innerHeight * TARGET_VIEWPORTS;
      let scale = 1;
      while (node.getBoundingClientRect().height < target && scale < MAX_SCALE - 1e-9) {
        scale = Math.min(MAX_SCALE, Math.round((scale + SCALE_STEP) * 100) / 100);
        node.style.setProperty("--issue-scale", String(scale));
      }

      let fold = planFold(node);
      if (fold !== null) {
        onFoldRef.current(fold);
        await nextPaint();
        if (cancelled) return false;
      }
      for (let step = 0; fold !== null && step < MAX_FOLD_STEPS; step += 1) {
        const overflow = foldOverflows(node);
        if (!overflow) break;
        fold = overflow.fold - 1;
        onFoldRef.current(fold);
        await nextPaint();
        if (cancelled) return false;
      }

      levelFlows(node);
      const widestGap = balanceColumns(node);

      const short = node.getBoundingClientRect().height < target;
      const holey = widestGap > MAX_SPREAD_GAP_PX;
      if (!short && !holey) return false;
      if (!allowRepick || repicked.current || isSpaciousLayout(layout)) return false;
      repicked.current = true;
      onRepickRef.current(pickSpaciousLayout());
      return true;
    }

    return () => {
      cancelled = true;
    };
  }, [ref, active, layout, total, allowRepick, resizeTick]);
}
