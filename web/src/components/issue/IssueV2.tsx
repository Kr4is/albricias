/* eslint-disable @next/next/no-img-element */
/**
 * V2 — broadsheet: four uniform columns with painted-on vertical rules.
 * Ported from `app/templates/issue_v2.html`, markup and classes unchanged.
 */

import IssueNav from "@/components/issue/IssueNav";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { mediaUrl } from "@/lib/media";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV2({
  issue,
  articles,
  prevIssue,
  nextIssue,
  isCurrentIssue,
  isPreview,
}: IssueLayoutProps) {
  return (
    <>
      <IssueNav
        prevIssue={prevIssue}
        nextIssue={nextIssue}
        isCurrentIssue={isCurrentIssue}
      />

      <div className="border-b-4 border-black mb-6"></div>

      {/* V2: BROADSHEET (4 Uniform Columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
        {/* Vertical Dividers (Visual Only) */}
        <div className="absolute inset-y-0 left-1/4 w-px bg-stone-300 hidden lg:block"></div>
        <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300 hidden lg:block"></div>
        <div className="absolute inset-y-0 left-3/4 w-px bg-stone-300 hidden lg:block"></div>

        {articles.map((article, index) => (
          <article
            key={article.id}
            className="flex flex-col h-full bg-stone-50/50 p-2"
          >
            <div className="mb-2 border-b border-stone-300 pb-1">
              <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-stone-500">
                {article.category}
              </span>
            </div>

            <a href={`/article/${article.id}`}>
              <h2
                className={`font-headline font-bold leading-tight mb-2 hover:underline
                ${index < 2 ? "text-2xl" : "text-lg"}`}
              >
                {article.title}
              </h2>
            </a>

            {index === 0 && (
              <figure className="mb-3 grayscale hover:grayscale-0 transition-all">
                <img
                  src={mediaUrl(issue.coverImage)}
                  alt=""
                  className="w-full h-32 object-cover border border-stone-300"
                />
              </figure>
            )}

            <div className="text-xs font-body leading-snug text-ink justified-text flex-grow">
              <p>
                {index < 2
                  ? article.content.slice(0, 300)
                  : article.content.slice(0, 150)}
                ...
              </p>
            </div>
          </article>
        ))}
      </div>

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
