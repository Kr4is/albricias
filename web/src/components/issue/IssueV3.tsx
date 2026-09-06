/* eslint-disable @next/next/no-img-element */
/**
 * V3 — hero layout: full-width lead over a three-column stream.
 * Ported from `app/templates/issue_v3.html`, markup and classes unchanged.
 */

import IssueNav from "@/components/issue/IssueNav";
import PreviewToolbar from "@/components/issue/PreviewToolbar";
import { mediaUrl } from "@/lib/media";
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

      {/* V3: HERO LAYOUT */}
      <div className="flex flex-col gap-8">
        {/* HERO SECTION (Full Width) */}
        {main && (
          <div className="relative border-b-2 border-black pb-8">
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-8">
                <a href={`/article/${main.id}`}>
                  <figure className="grayscale hover:grayscale-0 transition-all duration-700">
                    <img
                      src={mediaUrl(issue.coverImage)}
                      alt=""
                      className="w-full h-96 object-cover border border-black p-1"
                    />
                  </figure>
                </a>
              </div>
              <div className="col-span-12 lg:col-span-4 flex flex-col justify-center">
                <div className="mb-2">
                  <span className="font-sans text-xs font-bold uppercase tracking-[0.2em] bg-black text-white px-2 py-1">
                    {main.category}
                  </span>
                </div>
                <a href={`/article/${main.id}`}>
                  <h1 className="font-headline text-5xl lg:text-6xl font-black uppercase leading-none mb-4 hover:opacity-70 transition-opacity">
                    {main.title}
                  </h1>
                </a>
                <p className="font-body text-sm leading-relaxed border-l-4 border-stone-300 pl-4 italic">
                  {main.content.slice(0, 200)}...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* LOWER GRID (3 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 divide-x divide-stone-300">
          {rest.map((article, index) => (
            <article key={article.id} className={index !== 0 ? "pl-8" : ""}>
              <a href={`/article/${article.id}`}>
                <h3 className="font-headline text-xl font-bold mb-2 hover:underline">
                  {article.title}
                </h3>
              </a>
              <div className="text-xs font-body justified-text text-stone-600">
                <p>{article.content.slice(0, 200)}...</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <PreviewToolbar issue={issue} isPreview={isPreview} />
    </>
  );
}
