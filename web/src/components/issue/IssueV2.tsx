/**
 * V2 — dispatches: four ruled columns of brief items, the "quick reads" page
 * a real broadsheet runs alongside its feature front pages, with the same
 * kicker/hairline treatment as V1's rails.
 *
 * The four columns are one CSS multi-column flow (`.issue-flow`), not a
 * grid of fixed cells: copy runs from the foot of one column to the head
 * of the next, so all four end on the same line however long each item is.
 */

import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV2({
  articles,
  streamingArticleIds,
}: IssueLayoutProps) {
  return (
    <>

      <div className="border-b-4 border-black mb-6"></div>

      {/* V2: DISPATCHES (4 ruled columns) */}
      <div className="issue-flow columns-1 sm:columns-2 lg:columns-4 gap-12">
        {articles.map((article, index) => (
          <article key={article.id} className="mb-8 last:mb-0">
            <div className="flex items-center gap-2 mb-2 border-b border-stone-300 pb-1">
              {index < 2 && <span className="inline-block w-2 h-2 bg-ink"></span>}
              <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-stone-600">
                {article.category}
              </span>
            </div>

            <ArticleImage image={article.image} className="mb-2" />

            <a href={articleHref()}>
              <h2
                className={`font-headline font-bold leading-tight mb-2 hover:opacity-70 transition-opacity ${
                  index < 2 ? "text-2xl" : "text-lg"
                }`}
              >
                {article.title}
              </h2>
            </a>

            <ArticleBody article={article} className="text-xs font-body leading-snug text-ink-light justified-text" />
            {streamingArticleIds?.has(article.id) && <span className="typing-cursor" />}
          </article>
        ))}
      </div>

    </>
  );
}
