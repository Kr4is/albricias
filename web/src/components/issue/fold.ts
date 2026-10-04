/**
 * Splitting a layout's secondary stories between the above-the-fold rail and
 * the band below (see `fold` on `IssueLayoutProps`).
 */

import type { IssueArticle } from "@/components/issue/types";

/** `rest` cut at the fold: what the rail holds, and what runs below. */
export function cutAtFold(rest: IssueArticle[], fold: number | null | undefined) {
  const n = fold == null ? rest.length : Math.max(0, Math.min(fold, rest.length));
  return { above: rest.slice(0, n), below: rest.slice(n) };
}
