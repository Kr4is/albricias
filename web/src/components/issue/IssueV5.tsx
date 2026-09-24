/**
 * V5 — editorial grid: two half-page leads over a four-column brief bar.
 * Ported from `app/templates/issue_v5.html`; each story carries its own
 * `imageUrl` photo when it has one (`ArticleImage`), same as every layout.
 */

import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { renderMarkdown } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV5({
  issue,
  articles,
  streamingArticleId,
}: IssueLayoutProps) {
  const leads = articles.slice(0, 2);
  const rest = articles.slice(2);

  return (
    <>
      <IssueCoverBanner issue={issue} />

      {/* V5: EDITORIAL GRID */}
      <div className="flex flex-col gap-10">
        {/* TOP SECTION: TWO LEADS (Half and Half) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 border-b-2 border-black pb-10">
          {leads.map((article) => (
            <article key={article.id} className="flex flex-col">
              <div className="mb-2">
                <span className="font-sans text-[10px] font-bold uppercase tracking-widest bg-stone-100 px-1">
                  {article.category}
                </span>
              </div>
              <ArticleImage src={article.imageUrl} alt={article.title} eager className="mb-4" />
              <a href={articleHref()}>
                <h2 className="font-headline text-3xl lg:text-4xl font-black leading-none mb-4 hover:underline">
                  {article.title}
                </h2>
              </a>
              <ArticleBody html={renderMarkdown(article.content)} className="text-sm font-body leading-relaxed text-ink justified-text" />
              {article.id === streamingArticleId && <span className="typing-cursor" />}
            </article>
          ))}
        </div>

        {/* MIDDLE DIVIDER */}
        <div className="relative text-center -mt-14">
          <span className="bg-stone-50 px-4 font-sans text-xs font-bold uppercase tracking-widest text-stone-500">
            More News
          </span>
        </div>

        {/* BOTTOM SECTION: 4 COLUMNS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {rest.map((article) => (
            <article key={article.id} className="border-t border-stone-300 pt-4">
              <ArticleImage src={article.imageUrl} alt={article.title} className="mb-2" />
              <a href={articleHref()}>
                <h4 className="font-headline text-lg font-bold leading-tight mb-2 hover:text-stone-600 transition-colors">
                  {article.title}
                </h4>
              </a>
              <ArticleBody html={renderMarkdown(article.content)} className="text-xs font-body text-stone-500 leading-snug" />
              {article.id === streamingArticleId && <span className="typing-cursor" />}
            </article>
          ))}
        </div>
      </div>

    </>
  );
}
