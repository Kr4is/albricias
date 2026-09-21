/**
 * V3 — hero layout: full-width lead over a three-column stream.
 * Ported from `app/templates/issue_v3.html`. The hero's image column was
 * originally `issue.coverImage` treated as the lead story's own photo; that
 * field is now the edition's own cover art (see `IssueCoverBanner`, rendered
 * once for every layout), so the hero here is text-only — the cover banner
 * above already carries the issue's imagery.
 */

import IssueNav from "@/components/issue/IssueNav";
import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { excerpt } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV3({
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

      {/* V3: HERO LAYOUT */}
      <div className="flex flex-col gap-8">
        {/* HERO SECTION (Full Width) */}
        {main && (
          <div className="relative border-b-2 border-black pb-8">
            <div className="mb-2">
              <span className="font-sans text-xs font-bold uppercase tracking-[0.2em] bg-black text-white px-2 py-1">
                {main.category}
              </span>
            </div>
            <a href={articleHref(issue.id, main.id, isPreview)}>
              <h1 className="font-headline text-5xl lg:text-6xl font-black uppercase leading-none mb-4 hover:opacity-70 transition-opacity">
                {main.title}
              </h1>
            </a>
            <p className="font-body text-base leading-relaxed border-l-4 border-stone-300 pl-4 italic max-w-3xl">
              {excerpt(main.content, 320)}
            </p>
          </div>
        )}

        {/* LOWER GRID (3 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 divide-x divide-stone-300">
          {rest.map((article, index) => (
            <article key={article.id} className={index !== 0 ? "pl-8" : ""}>
              <a href={articleHref(issue.id, article.id, isPreview)}>
                <h3 className="font-headline text-xl font-bold mb-2 hover:underline">
                  {article.title}
                </h3>
              </a>
              <div className="text-xs font-body justified-text text-stone-600">
                <p>{excerpt(article.content, 200)}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
