/**
 * V2 — dispatches: four ruled columns of brief items, the "quick reads" page
 * a real broadsheet runs alongside its feature front pages. Reworked from
 * the original port (`app/templates/issue_v2.html`), which rendered four
 * uniform bg-tinted "cards" with absolutely-positioned divider lines — closer
 * to a modern dashboard grid than a newspaper page. `divide-x` on the grid
 * itself replaces the floating dividers (the rule now sits exactly on the
 * column gap, and can't drift out of alignment with the content), and the
 * kicker/hairline treatment matches V1's side columns instead of a card
 * background, so the two read as the same paper's typography.
 */

import IssueNav from "@/components/issue/IssueNav";
import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { excerpt } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
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
      <IssueCoverBanner issue={issue} />

      <div className="border-b-4 border-black mb-6"></div>

      {/* V2: DISPATCHES (4 ruled columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-stone-300">
        {articles.map((article, index) => (
          <article key={article.id} className="lg:px-6 first:pl-0 last:pr-0 mb-8 lg:mb-0">
            <div className="flex items-center gap-2 mb-2 border-b border-stone-300 pb-1">
              {index < 2 && <span className="inline-block w-2 h-2 bg-ink"></span>}
              <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-stone-600">
                {article.category}
              </span>
            </div>

            <a href={articleHref(issue.id, article.id, isPreview)}>
              <h2
                className={`font-headline font-bold leading-tight mb-2 hover:opacity-70 transition-opacity ${
                  index < 2 ? "text-2xl" : "text-lg"
                }`}
              >
                {article.title}
              </h2>
            </a>

            <div className="text-xs font-body leading-snug text-ink-light justified-text">
              <p>{excerpt(article.content, index < 2 ? 300 : 150)}</p>
            </div>
          </article>
        ))}
      </div>

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
