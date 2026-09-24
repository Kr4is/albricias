/**
 * V4 — asymmetric: an 8-column feature beside a 4-column "In Brief" rail.
 * Ported from `app/templates/issue_v4.html`. Two deviations from the
 * original: the sidebar used the class `active-text`, a typo for
 * `justified-text` that no stylesheet ever defined, so its excerpts rendered
 * ragged while every other column on the front page was justified — fixed
 * since this pass is specifically about the front page reading as a properly
 * finished vintage layout. And the feature's own image slot (originally
 * `issue.coverImage` treated as this one story's photo) is gone — that field
 * is now the edition's own cover art, rendered once for every layout by
 * `IssueCoverBanner` above. Each story's own photo comes from its
 * `imageUrl` instead (`ArticleImage`).
 *
 * The rail holds only as many briefs as fit beside the feature (the
 * `fold`); the rest run below in a balanced band (`BelowFold`), and the
 * balancer levels feature and rail so both end on the same line.
 */

import { Fragment } from "react";
import BelowFold from "@/components/issue/BelowFold";
import { cutAtFold } from "@/components/issue/fold";
import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { renderMarkdown } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV4({
  issue,
  articles,
  streamingArticleId,
  fold,
}: IssueLayoutProps) {
  const main = articles.length > 0 ? articles[0] : null;
  const { above, below } = cutAtFold(articles.slice(1), fold);

  return (
    <>
      <IssueCoverBanner issue={issue} />

      <div data-fold-group data-fold={above.length}>
        {/* V4: ASYMMETRIC LAYOUT */}
        <div data-balance-group className="grid grid-cols-12 gap-8 relative">
          {/* LEFT: MAIN FEATURE (8 Cols) */}
          <div data-balance-col data-fold-main className="col-span-12 lg:col-span-8 lg:border-r lg:border-black lg:pr-8">
            {main && (
              <article>
                <div className="flex items-center justify-between border-b border-black mb-4 pb-1">
                  <span className="font-sans text-xs font-bold uppercase tracking-widest">
                    {main.category}
                  </span>
                  <span className="font-sans text-xs uppercase text-stone-500">
                    {issue.dateLabel}
                  </span>
                </div>

                <a href={articleHref()}>
                  <h1 className="font-headline text-5xl md:text-7xl font-bold leading-none mb-6 hover:opacity-80 transition-opacity">
                    {main.title}
                  </h1>
                </a>

                <ArticleImage src={main.imageUrl} alt={main.title} eager className="mb-6" />

                <ArticleBody html={renderMarkdown(main.content)} className="columns-1 md:columns-2 gap-6 text-sm font-body leading-relaxed justified-text drop-cap" />
                {main.id === streamingArticleId && <span className="typing-cursor" />}
              </article>
            )}
          </div>

          {/* RIGHT: SIDEBAR STREAM (4 Cols) */}
          <div data-balance-col data-fold-rail className="col-span-12 lg:col-span-4 flex flex-col gap-8">
            <div data-rail-head className="border-b-4 border-double border-stone-300 pb-2 mb-2">
              <h3 className="font-sans text-center text-xs font-bold uppercase tracking-[0.2em]">
                In Brief
              </h3>
            </div>

            {above.map((article, index) => (
              <Fragment key={article.id}>
                <article data-story={article.id} data-order={index}>
                  <ArticleImage src={article.imageUrl} alt={article.title} className="mb-2" />
                  <a href={articleHref()}>
                    <h3 className="font-headline text-xl font-bold leading-tight mb-2 hover:underline">
                      {article.title}
                    </h3>
                  </a>
                  <ArticleBody html={renderMarkdown(article.content)} className="text-xs font-body justified-text text-stone-600" />
                  {article.id === streamingArticleId && <span className="typing-cursor" />}
                </article>
                {index !== above.length - 1 && <div data-rail-rule className="w-12 h-px bg-stone-300"></div>}
              </Fragment>
            ))}
          </div>
        </div>

        <BelowFold articles={below} streamingArticleId={streamingArticleId} />
      </div>
    </>
  );
}
