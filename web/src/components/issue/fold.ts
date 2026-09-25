/**
 * Splitting a layout's secondary stories between above-the-fold rails and
 * the band below (see `fold` on `IssueLayoutProps`).
 */

import type { IssueArticle } from "@/components/issue/types";

/** `rest` cut at the fold: what the rails hold, and what runs below. */
export function cutAtFold(rest: IssueArticle[], fold: number | null | undefined) {
  const n = fold == null ? rest.length : Math.max(0, Math.min(fold, rest.length));
  return { above: rest.slice(0, n), below: rest.slice(n) };
}

/**
 * A rough height for a story, in "words of body copy" — just enough to
 * deal stories between two rails so they start out close; the measured
 * balancing pass does the exact levelling afterwards.
 */
function weight(article: IssueArticle): number {
  const words = article.content.split(/\s+/).filter(Boolean).length;
  const blocks = (article.blocks ?? []).reduce((sum, block) => sum + (block.type === "chart" ? 55 : block.items.length * 12), 0);
  return 25 + words + (article.image ? 45 : 0) + blocks;
}

/**
 * Deals stories, in reading order, onto whichever of two rails is lighter
 * so far. A prefix-stable split: dropping the last story never moves an
 * earlier one, so lowering the fold only ever takes stories off the end.
 */
export function dealIntoTwo(articles: IssueArticle[]): [IssueArticle[], IssueArticle[]] {
  const rails: [IssueArticle[], IssueArticle[]] = [[], []];
  const load = [0, 0];
  for (const article of articles) {
    const side = load[0] <= load[1] ? 0 : 1;
    rails[side].push(article);
    load[side] += weight(article);
  }
  return rails;
}
