"use client";

/**
 * Closes the gap between a quiet period's rendered front page and what a
 * front page should look like — measured, not guessed from an article
 * count, and never by inventing content.
 *
 * Once generation is done and the page's images and fonts have settled, the
 * wrapper's height is compared against a floor (`TARGET_VIEWPORTS` × the
 * viewport). If it's short:
 *   1. `--issue-scale` (see `.issue-page` in globals.css) is raised in
 *      `SCALE_STEP`s up to `MAX_SCALE`, re-measuring after each step.
 *   2. Still short at the cap → one switch to a space-generous layout
 *      (`pickSpaciousLayout`), unless the visitor picked a layout
 *      themselves or the current one already is spacious. The new layout
 *      re-runs this same pass from scale 1.
 * The loop only ever moves one way (up, then stop), so it settles instead
 * of oscillating. A page that is already long enough is left alone — a
 * busy period simply runs long, like a real paper.
 *
 * The scale is written straight onto the wrapper's style, not React state:
 * it's a pure presentation knob, and measuring synchronously after each
 * step needs the DOM updated immediately rather than on the next render.
 */

import { useEffect, useRef, type RefObject } from "react";
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

/** Two frames — lets a just-removed failed image's figure leave the layout before measuring. */
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
}: {
  ref: RefObject<HTMLElement | null>;
  /** Generation finished — nothing is measured while text is still streaming in. */
  active: boolean;
  layout: LayoutIndex | null;
  total: number;
  /** `false` once the visitor has chosen a layout by hand — their choice is never overridden. */
  allowRepick: boolean;
  onRepick: (layout: LayoutIndex) => void;
}) {
  const repicked = useRef(false);
  // Read through a ref so a new callback identity each render doesn't re-trigger the pass.
  const onRepickRef = useRef(onRepick);
  useEffect(() => {
    onRepickRef.current = onRepick;
  });

  useEffect(() => {
    if (!active) repicked.current = false;
  }, [active]);

  useEffect(() => {
    const node = ref.current;
    if (!active || !node || layout === null) return;
    let cancelled = false;
    node.style.setProperty("--issue-scale", "1");

    (async () => {
      await Promise.all([imagesSettled(node), document.fonts?.ready]);
      await nextPaint();
      if (cancelled || window.innerWidth < MIN_VIEWPORT_WIDTH) return;

      const target = window.innerHeight * TARGET_VIEWPORTS;
      let scale = 1;
      while (node.getBoundingClientRect().height < target && scale < MAX_SCALE - 1e-9) {
        scale = Math.min(MAX_SCALE, Math.round((scale + SCALE_STEP) * 100) / 100);
        node.style.setProperty("--issue-scale", String(scale));
      }

      if (node.getBoundingClientRect().height >= target) return;
      if (!allowRepick || repicked.current || isSpaciousLayout(layout)) return;
      repicked.current = true;
      onRepickRef.current(pickSpaciousLayout(total));
    })();

    return () => {
      cancelled = true;
    };
  }, [ref, active, layout, total, allowRepick]);
}
