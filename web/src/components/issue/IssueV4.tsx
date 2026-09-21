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
 * `IssueCoverBanner` above, not any single story's.
 */

import IssueNav from "@/components/issue/IssueNav";
import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { excerpt } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV4({
  issue,
  articles,
  prevIssue,
  nextIssue,
  isCurrentIssue,
  isPreview,
}: IssueLayoutProps) {
  const main = articles.length > 0 ? articles[0] : null;
  const rest = articles.slice(1);

  return (
    <>
      <IssueNav
        prevIssue={prevIssue}
        nextIssue={nextIssue}
        isCurrentIssue={isCurrentIssue}
      />
      <IssueCoverBanner issue={issue} />

      {/* V4: ASYMMETRIC LAYOUT */}
      <div className="grid grid-cols-12 gap-8 relative">
        {/* LEFT: MAIN FEATURE (8 Cols) */}
        <div className="col-span-12 lg:col-span-8 lg:border-r lg:border-black lg:pr-8">
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

              <a href={articleHref(issue.id, main.id, isPreview)}>
                <h1 className="font-headline text-5xl md:text-7xl font-bold leading-none mb-6 hover:opacity-80 transition-opacity">
                  {main.title}
                </h1>
              </a>

              <div className="columns-1 md:columns-2 gap-6 text-sm font-body leading-relaxed justified-text drop-cap">
                <p>{excerpt(main.content, 600)}</p>
              </div>
            </article>
          )}
        </div>

        {/* RIGHT: SIDEBAR STREAM (4 Cols) */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-8">
          <div className="border-b-4 border-double border-stone-300 pb-2 mb-2">
            <h3 className="font-sans text-center text-xs font-bold uppercase tracking-[0.2em]">
              In Brief
            </h3>
          </div>

          {rest.map((article) => (
            <article key={article.id}>
              <a href={articleHref(issue.id, article.id, isPreview)}>
                <h3 className="font-headline text-xl font-bold leading-tight mb-2 hover:underline">
                  {article.title}
                </h3>
              </a>
              <p className="text-xs font-body justified-text text-stone-600 mb-2">
                {excerpt(article.content, 120)}
              </p>
              <div className="w-12 h-px bg-stone-300"></div>
            </article>
          ))}
        </div>
      </div>

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
