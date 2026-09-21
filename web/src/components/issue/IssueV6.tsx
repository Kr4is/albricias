/**
 * V6 — broadside: one story runs the whole width of the page under a giant
 * banner headline, the way a special edition leads with a single story
 * instead of splitting the front page into competing columns. Everything
 * else on the front page is relegated to a dense, single-column index below
 * — numbered dispatches with a one-line teaser each, not another grid.
 *
 * New with this pass (no Flask/Jinja original to port) — added alongside a
 * general front-page polish pass specifically because the other five
 * layouts are all variations on "several columns of roughly equal weight";
 * this is the one front page that says the month had one big thing to lead
 * with.
 */

import IssueNav from "@/components/issue/IssueNav";
import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { excerpt } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV6({
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

      {/* V6: BROADSIDE */}
      {main && (
        <div className="border-y-4 border-double border-ink py-8 mb-10 text-center">
          <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-stone-500">
            {main.category} · {issue.dateLabel}
          </span>
          <a href={articleHref(issue.id, main.id, isPreview)}>
            <h1 className="font-headline text-6xl md:text-8xl font-black uppercase leading-[0.95] my-6 hover:opacity-80 transition-opacity">
              {main.title}
            </h1>
          </a>
          <div className="columns-1 md:columns-2 gap-8 text-left text-base font-body leading-relaxed justified-text text-ink-light max-w-4xl mx-auto drop-cap">
            <p>{excerpt(main.content, 700)}</p>
          </div>
        </div>
      )}

      {/* INDEX OF THE REST (single dense column) */}
      {rest.length > 0 && (
        <div className="max-w-3xl mx-auto">
          <div className="border-b border-ink mb-4 pb-1">
            <h3 className="font-sans text-xs font-bold uppercase tracking-[0.2em]">
              Also in This Issue
            </h3>
          </div>
          <ol className="flex flex-col">
            {rest.map((article, index) => (
              <li
                key={article.id}
                className="flex gap-4 py-4 border-b border-dotted border-stone-300 last:border-none"
              >
                <span className="font-headline text-2xl text-stone-300 leading-none shrink-0">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <a href={articleHref(issue.id, article.id, isPreview)}>
                    <h4 className="font-headline text-lg font-bold leading-tight hover:underline">
                      {article.title}
                    </h4>
                  </a>
                  <p className="text-xs font-body text-stone-600 mt-1">
                    {excerpt(article.content, 160)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
