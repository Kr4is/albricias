/* eslint-disable @next/next/no-img-element */
/**
 * V1 — three-column front page with a centred lead story.
 * Ported from `app/templates/issue_v1.html`, markup and classes unchanged.
 *
 * The Jinja template distributes the non-lead articles round-robin across the
 * three columns with `[0::3]`, `[1::3]` and `[2::3]`; `everyThird` below is the
 * same slice. The hairline `<div>`s between articles are siblings of the
 * `<article>` elements in the original too — they participate in the
 * `article:nth-child()` animation delays in style.css, so their position in the
 * DOM matters.
 */

import { Fragment } from "react";
import IssueNav from "@/components/issue/IssueNav";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { mediaUrl } from "@/lib/media";
import type { IssueArticle, IssueLayoutProps } from "@/components/issue/types";

/** Python's `seq[start::3]`. */
function everyThird(articles: IssueArticle[], start: number): IssueArticle[] {
  return articles.filter((_, index) => index % 3 === start);
}

export default function IssueV1({
  issue,
  articles,
  prevIssue,
  nextIssue,
  isCurrentIssue,
  isPreview,
}: IssueLayoutProps) {
  const mainArticle = articles.length > 0 ? articles[0] : null;
  const otherArticles = articles.slice(1);

  const leftColumn = everyThird(otherArticles, 0);
  const centerColumn = everyThird(otherArticles, 1);
  const rightColumn = everyThird(otherArticles, 2);

  return (
    <>
      <IssueNav
        prevIssue={prevIssue}
        nextIssue={nextIssue}
        isCurrentIssue={isCurrentIssue}
      />

      {/* Main Grid Layout */}
      <div className="grid grid-cols-12 gap-6 lg:gap-8 relative">
        {/* Column 1: Left Stream (approx 1/3 of remainder) */}
        <div className="col-span-12 lg:col-span-3 lg:border-r lg:border-stone-300 lg:pr-6 flex flex-col gap-8">
          {leftColumn.map((article, index) => (
            <Fragment key={article.id}>
              <article>
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

                <a href={`/article/${article.id}`}>
                  <h2 className="font-headline text-xl lg:text-2xl font-bold leading-tight mb-2 hover:opacity-70 transition-opacity">
                    {article.title}
                  </h2>
                </a>

                <div className="text-sm font-body leading-relaxed text-ink-light space-y-2 justified-text">
                  <p>{article.content.slice(0, 200)}...</p>
                </div>
              </article>
              {index !== leftColumn.length - 1 && (
                <div className="w-16 h-px bg-stone-200 mx-auto"></div>
              )}
            </Fragment>
          ))}
        </div>

        {/* Column 2: Center (Lead + Stream) */}
        <div className="col-span-12 lg:col-span-6 lg:border-r lg:border-stone-300 lg:px-6 flex flex-col">
          {/* LEAD ARTICLE */}
          {mainArticle && (
            <article className="mb-12 border-b-4 border-double border-stone-300 pb-8">
              <a href={`/article/${mainArticle.id}`}>
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

              <figure className="mb-6 grayscale hover:grayscale-0 transition-all duration-700 cursor-pointer">
                <img
                  src={mediaUrl(issue.coverImage)}
                  alt={mainArticle.title}
                  className="w-full h-auto object-cover border border-stone-300 p-1 bg-white"
                />
              </figure>

              <div className="columns-1 md:columns-2 gap-6 text-sm font-body leading-relaxed justified-text text-ink drop-cap">
                <p>{mainArticle.content.slice(0, 500)}...</p>
              </div>
            </article>
          )}

          {/* SECONDARY STREAM (Center Bottom) */}
          <div className="flex flex-col gap-8">
            {centerColumn.map((article, index) => (
              <Fragment key={article.id}>
                <article>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-2 h-2 bg-ink"></span>
                    <span className="font-sans text-[10px] font-bold uppercase tracking-widest">
                      {article.category}
                    </span>
                  </div>
                  <a href={`/article/${article.id}`}>
                    <h2 className="font-headline text-2xl font-bold leading-tight mb-2 hover:underline">
                      {article.title}
                    </h2>
                  </a>
                  <p className="text-sm font-body leading-relaxed text-ink-light">
                    {article.content.slice(0, 250)}...
                  </p>
                </article>
                {index !== centerColumn.length - 1 && (
                  <div className="border-t border-dotted border-stone-300 w-full"></div>
                )}
              </Fragment>
            ))}
          </div>
        </div>

        {/* Column 3: Right Stream (approx 1/3 of remainder) */}
        <div className="col-span-12 lg:col-span-3 lg:pl-6 flex flex-col gap-8">
          {rightColumn.map((article) => (
            <Fragment key={article.id}>
              <article>
                <div className="mb-1">
                  <span className="font-sans text-[9px] font-bold uppercase tracking-widest bg-stone-100 px-1">
                    {article.category}
                  </span>
                </div>
                <a href={`/article/${article.id}`}>
                  <h3 className="font-headline text-lg font-bold leading-tight mb-2 hover:opacity-70">
                    {article.title}
                  </h3>
                </a>
                <p className="text-xs font-body justified-text leading-snug text-stone-600">
                  {article.content.slice(0, 150)}...
                </p>
              </article>
              <div className="w-full border-t border-stone-200"></div>
            </Fragment>
          ))}
        </div>
      </div>

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
