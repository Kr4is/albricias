/** Shared shapes for the six broadsheet layouts (`IssueV1` … `IssueV6`). */

/** An article as the issue layouts render it. */
export interface IssueArticle {
  id: number;
  title: string;
  content: string;
  category: string;
  author: string | null;
  deck: string;
  /** A real image of the repository this article is about (GitHub's social-preview card), when it has one. */
  imageUrl?: string | null;
}

/** A generated issue as the issue layouts and masthead render it. */
export interface IssueView {
  id: number;
  title: string;
  status: string;
  vol: string;
  coverImage: string | null;
  dateLabel: string;
  dateShortLabel: string;
  weather: string;
}

/** Props every `IssueV*` layout takes. */
export interface IssueLayoutProps {
  issue: IssueView;
  articles: IssueArticle[];
  /** The article currently receiving live text deltas, if any — shows a blinking cursor after its body. */
  streamingArticleId?: number | null;
}
