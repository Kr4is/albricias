/**
 * Shared shapes for the five broadsheet layouts (`issue_v1` … `issue_v5`).
 *
 * The Jinja templates read the SQLAlchemy objects directly and leaned on
 * computed properties (`issue.date`, `issue.date_short`, `issue.weather`).
 * Those are pure functions here (`src/lib/edition-helpers.ts`), so pages
 * resolve them once via `toIssueView`/`toIssueNavRef` in `src/lib/issue-view.ts`
 * and hand the layouts plain data.
 */

/** An article as the issue layouts render it. */
export interface IssueArticle {
  id: number;
  title: string;
  content: string;
  category: string;
  author: string | null;
  deck: string;
}

/** An edition as the issue layouts and masthead render it. */
export interface IssueView {
  id: number;
  title: string;
  status: string;
  vol: string;
  coverImage: string | null;
  /** `Edition.date` in Flask. */
  dateLabel: string;
  /** `Edition.date_short` in Flask. */
  dateShortLabel: string;
  /** `Edition.weather` in Flask. */
  weather: string;
}

/** The minimum an adjacent edition needs for the prev/next nav. */
export interface IssueNavRef {
  id: number;
  dateShortLabel: string;
}

/**
 * Props every `issue_v*.html` port takes, mirroring the context
 * `public.py:72-81` / `public.py:195-204` passed to `render_template`.
 */
export interface IssueLayoutProps {
  issue: IssueView;
  /** Already ordered by `Article.order` — the layouts slice, they never sort. */
  articles: IssueArticle[];
  prevIssue: IssueNavRef | null;
  nextIssue: IssueNavRef | null;
  isCurrentIssue: boolean;
  isPreview: boolean;
}
