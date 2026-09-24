/**
 * Front-page layout selection (`IssueV1` … `IssueV6`).
 *
 * Each layout has a real structural sweet spot for how many articles it
 * takes to fill without empty grid tracks — a 4-column dispatch grid with
 * 1 article looks broken, a lead-only layout is fine with just 1. Picking
 * randomly within the pool of layouts that actually suit the real article
 * count avoids that, purely visually — no content is ever invented to
 * "fill" a layout that doesn't fit what's there. The manual switcher in
 * `AppClient.tsx` still offers all 6 unconditionally; this only decides
 * the default a visitor sees first.
 */

/** Number of broadsheet layout variants (`IssueV1` … `IssueV6`). */
export const LAYOUT_COUNT = 6;

export type LayoutIndex = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Layout pools by total article count (prose sections + deterministic
 * stars/numbers articles), derived from reading each `IssueV*.tsx`:
 *   - V1 (3-col + lead, round-robin split): needs lead + ≥3 secondary.
 *   - V2 (4-col dispatch grid, no lead): needs ≥4 to fill the row.
 *   - V3 (hero + `divide-x` 3-col grid): 1-2 "rest" leaves visible empty
 *     divided tracks — safe only at total 1 (grid collapses) or ≥4.
 *   - V4 (8/4 asymmetric, plain vertical sidebar list): safe at any total.
 *   - V5 (2 half-width leads + 4-col bar): safe at total 2 (both halves
 *     fill) or ≥6 (bar gets ≥4); 3-5 leaves the bar half-empty.
 *   - V6 (broadside + plain numbered index): safe at any total.
 */
export function pickLayoutForContent(total: number): LayoutIndex {
  const pool: LayoutIndex[] =
    total <= 1 ? [3, 4, 6] :
    total <= 3 ? [4, 6] :
    total === 4 ? [1, 3, 4, 6] :
    total <= 7 ? [1, 2, 4, 5] :
    [1, 2, 5];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * The most space-generous layouts that still suit `total` — what
 * `usePageFill` falls back to when a page is short even at its largest type
 * scale. V3 (full-width hero) and V6 (broadside) give the lead story the
 * whole sheet; V3's divided stream only suits a total of 1 or ≥4 (see the
 * pools above), V6 suits any.
 */
export function pickSpaciousLayout(total: number): LayoutIndex {
  const pool: LayoutIndex[] = total === 1 || total >= 4 ? [3, 6] : [6];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Whether `layout` is already one `pickSpaciousLayout` would choose from. */
export function isSpaciousLayout(layout: LayoutIndex): boolean {
  return layout === 3 || layout === 6;
}
