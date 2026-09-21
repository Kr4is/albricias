/**
 * Front-page layout selection (`issue_v1` … `issue_v5`).
 *
 * Originally a deterministic rotation ported from `layout_index` in
 * `app/helpers.py:19-21` (`(edition.month % 5) + 1`) — every edition from the
 * same calendar month, any year, always rendered identically. Replaced with a
 * random pick made once at generation time and persisted on
 * `Edition.layoutVariant`, so a real newspaper's front page varies edition to
 * edition rather than repeating on a fixed yearly cycle, while still staying
 * stable across reloads (it's read from the DB, not re-rolled per request).
 *
 * The old month-based formula lives on as {@link layoutIndex}'s fallback for
 * editions created before `layoutVariant` existed, so an already-published
 * archive doesn't change its look retroactively.
 */

/** Number of broadsheet layout variants (`issue_v1` … `issue_v5`). */
export const LAYOUT_COUNT = 5;

export type LayoutIndex = 1 | 2 | 3 | 4 | 5;

/** Minimal shape needed to pick a layout — any Edition row satisfies it. */
export interface EditionLayoutInput {
  periodStart: Date;
  layoutVariant?: number | null;
}

/** A fresh random layout pick — call once per edition, at generation time, and persist it. */
export function randomLayoutIndex(): LayoutIndex {
  return (Math.floor(Math.random() * LAYOUT_COUNT) + 1) as LayoutIndex;
}

/** Return the layout variant (1–5) an edition renders with. */
export function layoutIndex(edition: EditionLayoutInput): LayoutIndex {
  const stored = edition.layoutVariant;
  if (stored && stored >= 1 && stored <= LAYOUT_COUNT) {
    return stored as LayoutIndex;
  }
  const month = edition.periodStart.getUTCMonth() + 1; // 1-12
  return ((month % LAYOUT_COUNT) + 1) as LayoutIndex;
}
