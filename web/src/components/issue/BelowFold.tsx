/**
 * The band under a V1/V4 front page's fold: whichever secondary stories
 * didn't fit in the rails beside the lead (see `fold` on
 * `IssueLayoutProps`), set as one balanced multi-column flow so every
 * column ends on the same line.
 */

import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { renderMarkdown } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueArticle } from "@/components/issue/types";

export default function BelowFold({
  articles,
  streamingArticleIds,
  wide = false,
}: {
  articles: IssueArticle[];
  streamingArticleIds?: ReadonlySet<number>;
  /** Four columns on desktop instead of three. */
  wide?: boolean;
}) {
  if (articles.length === 0) return null;
  return (
    <section className="mt-10 border-t-4 border-double border-stone-300 pt-4">
      <h3 className="font-sans text-center text-xs font-bold uppercase tracking-[0.2em] mb-6">
        More in This Issue
      </h3>
      <div className={`issue-flow columns-1 md:columns-2 gap-8 ${wide ? "lg:columns-4" : "lg:columns-3"}`}>
        {articles.map((article) => (
          <article key={article.id} className="mb-8 last:mb-0">
            <div className="mb-1">
              <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-stone-600">
                {article.category}
              </span>
            </div>
            <ArticleImage src={article.imageUrl} alt={article.title} className="mb-2" />
            <a href={articleHref()}>
              <h3 className="font-headline text-xl font-bold leading-tight mb-2 hover:underline">
                {article.title}
              </h3>
            </a>
            <ArticleBody html={renderMarkdown(article.content)} className="text-sm font-body leading-relaxed text-ink-light justified-text" />
            {streamingArticleIds?.has(article.id) && <span className="typing-cursor" />}
          </article>
        ))}
      </div>
    </section>
  );
}
