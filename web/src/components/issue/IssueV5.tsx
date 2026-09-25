/**
 * V5 — editorial grid: two half-page leads over a four-column brief bar.
 *
 * Both tiers are balanced multi-column flows: the two leads run on from
 * one half into the other rather than each stopping at its own length,
 * and the brief bar likewise, so every column ends on the same line.
 */

import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV5({
  articles,
  streamingArticleIds,
}: IssueLayoutProps) {
  const leads = articles.slice(0, 2);
  const rest = articles.slice(2);

  return (
    <>

      {/* V5: EDITORIAL GRID */}
      <div className="flex flex-col gap-10">
        {/* TOP SECTION: TWO LEADS (Half and Half) */}
        <div className="issue-flow columns-1 md:columns-2 gap-10 border-b-2 border-black pb-10">
          {leads.map((article) => (
            <article key={article.id} className="mb-8 last:mb-0">
              <div className="mb-2">
                <span className="font-sans text-[10px] font-bold uppercase tracking-widest bg-stone-100 px-1">
                  {article.category}
                </span>
              </div>
              <ArticleImage image={article.image} eager className="mb-4" />
              <a href={articleHref()}>
                <h2 className="font-headline text-3xl lg:text-4xl font-black leading-none mb-4 hover:underline">
                  {article.title}
                </h2>
              </a>
              <ArticleBody article={article} className="text-sm font-body leading-relaxed text-ink justified-text" />
              {streamingArticleIds?.has(article.id) && <span className="typing-cursor" />}
            </article>
          ))}
        </div>

        {rest.length > 0 && (
          <>
            {/* MIDDLE DIVIDER */}
            <div className="relative text-center -mt-14">
              <span className="bg-paper px-4 font-sans text-xs font-bold uppercase tracking-widest text-stone-500">
                More News
              </span>
            </div>

            {/* BOTTOM SECTION: 4 COLUMNS */}
            <div className="issue-flow columns-1 sm:columns-2 lg:columns-4 gap-8 border-t border-stone-300 pt-4">
              {rest.map((article) => (
                <article key={article.id} className="mb-6 last:mb-0">
                  <ArticleImage image={article.image} className="mb-2" />
                  <a href={articleHref()}>
                    <h4 className="font-headline text-lg font-bold leading-tight mb-2 hover:text-stone-600 transition-colors">
                      {article.title}
                    </h4>
                  </a>
                  <ArticleBody article={article} className="text-xs font-body text-stone-500 leading-snug" />
                  {streamingArticleIds?.has(article.id) && <span className="typing-cursor" />}
                </article>
              ))}
            </div>
          </>
        )}
      </div>

    </>
  );
}
