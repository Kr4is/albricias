/**
 * Front-page layout selection (`IssueV1` … `IssueV6`).
 *
 * Each layout has a minimum article count below which it would leave empty
 * tracks. Picking randomly within the layouts that suit the real article
 * count avoids that, purely visually — no content is ever invented to
 * "fill" a layout that doesn't fit what's there. The manual switcher in
 * `AppClient.tsx` still offers all 6 unconditionally; this only decides
 * the default a visitor sees first.
 */

export type LayoutIndex = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The fewest articles each layout fills without leaving paper bare, from
 * measuring them (`scripts/check-layouts.ts`). Every layout but V4 and V5
 * sets its stories in column flows, which fill however few there are; V4's
 * side rail needs briefs to hold, and V5 two leads to put side by side.
 */
const MIN_ARTICLES: Record<LayoutIndex, number> = { 1: 1, 2: 1, 3: 1, 4: 3, 5: 2, 6: 1 };

/** Every layout that suits `total` articles (prose sections + the stars/numbers boxes). */
export function layoutsFor(total: number): LayoutIndex[] {
  return ([1, 2, 3, 4, 5, 6] as const).filter((layout) => MIN_ARTICLES[layout] <= total);
}

export function pickLayoutForContent(total: number): LayoutIndex {
  const pool = layoutsFor(total);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * The most space-generous layouts that still suit `total` — what
 * `usePageFill` falls back to when a page is short even at its largest type
 * scale. V3 (full-width hero) and V6 (the extra) give the lead story the
 * whole sheet; both suit any article count.
 */
export function pickSpaciousLayout(): LayoutIndex {
  return Math.random() < 0.5 ? 3 : 6;
}

/** Whether `layout` is already one `pickSpaciousLayout` would choose from. */
export function isSpaciousLayout(layout: LayoutIndex): boolean {
  return layout === 3 || layout === 6;
}
