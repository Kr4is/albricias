/**
 * V1 — three-column front page with a centred lead story.
 *
 * The lead holds the centre; the secondary stories sit on the two side
 * rails, but only as many as fit beside the lead — the `fold`. The rest
 * run below in a balanced band (`BelowFold`). Which story goes on which
 * rail is measured (`leftRailIds`, from `planFold`), falling back to a
 * rough-length deal (`dealIntoTwo`) before the first measurement; the
 * balancer then levels the three columns so they end on the same line.
 * Both rails share one story style (`Rail`), so a story is the same height
 * on either side.
 */

import { Fragment } from "react";
import BelowFold from "@/components/issue/BelowFold";
import { cutAtFold, dealIntoTwo } from "@/components/issue/fold";
import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { articleHref } from "@/lib/issue-view";
import type { IssueArticle, IssueLayoutProps } from "@/components/issue/types";

/**
 * One side rail's stories. Both rails share this markup, so a story is the
 * same height in either — what lets the balancer measure each story once
 * and work out the best split between the rails (`planFold`).
 */
function Rail({
  articles,
  order,
  streamingArticleIds,
}: {
  articles: IssueArticle[];
  /** Every above-fold story, in reading order — each story's position in it is its `data-order`. */
  order: IssueArticle[];
  streamingArticleIds?: ReadonlySet<number>;
}) {
  return articles.map((article, index) => (
    <Fragment key={article.id}>
      <article data-story={article.id} data-order={order.indexOf(article)}>
        {/* Meta / Category */}
        <div className="flex items-center justify-between mb-1 border-b border-stone-300 pb-1">
          <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-stone-600">
            {article.category}
          </span>
          {article.author && (
            <span className="font-sans text-[9px] uppercase text-stone-400">
              {article.author}
            </span>
          )}
        </div>

        <ArticleImage image={article.image} className="mb-2" />

        <a href={articleHref()}>
          <h2 className="font-headline text-xl lg:text-2xl font-bold leading-tight mb-2 hover:opacity-70 transition-opacity">
            {article.title}
          </h2>
        </a>

        <ArticleBody article={article} className="text-sm font-body leading-relaxed text-ink-light space-y-2 justified-text" />
        {streamingArticleIds?.has(article.id) && <span className="typing-cursor" />}
      </article>
      {index !== articles.length - 1 && <div data-rail-rule className="w-16 h-px bg-stone-200 mx-auto"></div>}
    </Fragment>
  ));
}

export default function IssueV1({
  issue,
  articles,
  streamingArticleIds,
  fold,
  leftRailIds,
}: IssueLayoutProps) {
  const mainArticle = articles.length > 0 ? articles[0] : null;
  const rest = articles.slice(1);
  const { above, below } = cutAtFold(rest, fold);
  const [leftColumn, rightColumn] = leftRailIds
    ? [above.filter((a) => leftRailIds.includes(a.id)), above.filter((a) => !leftRailIds.includes(a.id))]
    : dealIntoTwo(above);

  return (
    <>

      <div data-fold-group data-fold={above.length}>
        {/* Main Grid Layout */}
        <div data-balance-group className="grid grid-cols-12 gap-6 lg:gap-8 relative">
          {/* Column 1: Left rail */}
          <div data-balance-col data-fold-rail className="col-span-12 lg:col-span-3 lg:border-r lg:border-stone-300 lg:pr-6 flex flex-col gap-8">
            <Rail articles={leftColumn} order={above} streamingArticleIds={streamingArticleIds} />
          </div>

          {/* Column 2: Center (Lead) */}
          <div data-balance-col data-fold-main className="order-first lg:order-none col-span-12 lg:col-span-6 lg:border-r lg:border-stone-300 lg:px-6 flex flex-col">
            {/* LEAD ARTICLE */}
            {mainArticle && (
              <article>
                <a href={articleHref()}>
                  <h2 className="font-headline text-5xl md:text-7xl font-black uppercase tracking-tight leading-none mb-4 text-center hover:opacity-80 transition-opacity">
                    {mainArticle.title}
                  </h2>
                </a>

                <div className="border-y border-ink py-1 mb-5 flex justify-between items-center">
                  <h4 className="font-sans text-[10px] font-bold uppercase tracking-widest flex-1 text-center">
                    {mainArticle.category}
                  </h4>
                  <span className="w-px h-3 bg-ink mx-2"></span>
                  <h4 className="font-sans text-[10px] font-bold uppercase tracking-widest flex-1 text-center">
                    {issue.dateLabel}
                  </h4>
                </div>

                <ArticleImage image={mainArticle.image} eager className="mb-5" />

                <ArticleBody article={mainArticle} className="columns-1 md:columns-2 gap-6 text-sm font-body leading-relaxed justified-text text-ink drop-cap" />
                {streamingArticleIds?.has(mainArticle.id) && <span className="typing-cursor" />}
              </article>
            )}
          </div>

          {/* Column 3: Right rail */}
          <div data-balance-col data-fold-rail className="col-span-12 lg:col-span-3 lg:pl-6 flex flex-col gap-8">
            <Rail articles={rightColumn} order={above} streamingArticleIds={streamingArticleIds} />
          </div>
        </div>

        <BelowFold articles={below} streamingArticleIds={streamingArticleIds} wide />
      </div>
    </>
  );
}
