/** Shared shapes for the six broadsheet layouts (`IssueV1` … `IssueV6`). */

import type { ArticleBlock, ArticleImageRef } from "@/lib/article-blocks";

/** An article as the issue layouts render it. */
export interface IssueArticle {
  id: number;
  title: string;
  content: string;
  category: string;
  author: string | null;
  deck: string;
  /** A picture the repository this article is about shows of itself, when it has one. */
  image?: ArticleImageRef | null;
  /** Charts, facts and repo cards, after the prose (a computed box has only these). */
  blocks?: ArticleBlock[];
}

/** What the issue layouts show of the edition itself. */
export interface IssueView {
  /** The period, as the layouts' kicker lines print it — e.g. `"Week of March 3, 2026"`. */
  dateLabel: string;
}

/** Props every `IssueV*` layout takes. */
export interface IssueLayoutProps {
  issue: IssueView;
  articles: IssueArticle[];
  /** The articles currently receiving live text deltas — each shows a blinking cursor after its body. */
  streamingArticleIds?: ReadonlySet<number>;
  /**
   * How many secondary stories sit above the fold, in the side rails beside
   * the lead (V1, V4) — the rest run in a balanced band below. `null`/absent
   * means all of them; `usePageFill` lowers it one story at a time while a
   * rail runs longer than the lead.
   */
  fold?: number | null;
  /** V1 only: ids of the above-fold stories on the left rail (the rest go right), as measured by `planFold`. */
  leftRailIds?: number[] | null;
}
