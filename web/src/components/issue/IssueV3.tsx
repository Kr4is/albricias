/**
 * V3 — hero layout: full-width lead over a three-column stream.
 * Ported from `app/templates/issue_v3.html`. The hero's image column was
 * originally `issue.coverImage` treated as the lead story's own photo; that
 * field is now the edition's own cover art (see `IssueCoverBanner`, rendered
 * once for every layout). The hero and the stream below it carry each
 * story's own `imageUrl` instead, when it has one (`ArticleImage`).
 *
 * The hero's copy runs in its own balanced multi-column flow with its
 * picture at the head of the first column, and the stream below is one
 * too, so every column on the page ends level. (An earlier version set the
 * picture beside the copy stretched to its height — a long story cropped
 * the card to a sliver.)
 */

import IssueCoverBanner from "@/components/issue/IssueCoverBanner";
import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { renderMarkdown } from "@/lib/markdown";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV3({
  issue,
  articles,
  streamingArticleId,
}: IssueLayoutProps) {
  const main = articles.length > 0 ? articles[0] : null;
  const rest = articles.slice(1);

  return (
    <>
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
            <a href={articleHref()}>
              <h1 className="font-headline text-5xl lg:text-6xl font-black uppercase leading-none mb-4 hover:opacity-70 transition-opacity">
                {main.title}
              </h1>
            </a>
            <div className="issue-flow columns-1 md:columns-2 lg:columns-3 gap-10">
              <ArticleImage src={main.imageUrl} alt={main.title} eager className="mb-4" />
              <ArticleBody html={renderMarkdown(main.content)} className="font-body text-base leading-relaxed justified-text" />
              {main.id === streamingArticleId && <span className="typing-cursor" />}
            </div>
          </div>
        )}

        {/* LOWER GRID (3 Columns) */}
        <div className="issue-flow columns-1 md:columns-3 gap-16">
          {rest.map((article) => (
            <article key={article.id} className="mb-8 last:mb-0">
              <ArticleImage src={article.imageUrl} alt={article.title} className="mb-3" />
              <a href={articleHref()}>
                <h3 className="font-headline text-xl font-bold mb-2 hover:underline">
                  {article.title}
                </h3>
              </a>
              <ArticleBody html={renderMarkdown(article.content)} className="text-xs font-body justified-text text-stone-600" />
              {article.id === streamingArticleId && <span className="typing-cursor" />}
            </article>
          ))}
        </div>
      </div>

    </>
  );
}
