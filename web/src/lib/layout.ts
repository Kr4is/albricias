/**
 * Deterministic layout rotation, ported from `layout_index` in
 * `app/helpers.py:19-21`:
 *
 *     return (edition.month % 5) + 1
 *
 * The period model replaced `month`, so the month of `periodStart` is the
 * input. For migrated monthly editions `periodStart` is the first of the
 * month, so every historical edition keeps the exact layout it renders today.
 */

/** Number of broadsheet layout variants (`issue_v1` … `issue_v5`). */
export const LAYOUT_COUNT = 5;

export type LayoutIndex = 1 | 2 | 3 | 4 | 5;

/** Minimal shape needed to pick a layout — any Edition row satisfies it. */
export interface EditionLayoutInput {
  periodStart: Date;
}

/** Return the layout variant (1–5) an edition renders with. */
export function layoutIndex(edition: EditionLayoutInput): LayoutIndex {
  const month = edition.periodStart.getUTCMonth() + 1; // 1-12
  return ((month % LAYOUT_COUNT) + 1) as LayoutIndex;
}
