/**
 * V6 — the extra: a special edition's front page. A banner headline across
 * the sheet, the lead in a wide three-column flow beneath it, and a numbered
 * "Also in This Issue" index set in a four-column flow below — both flows
 * run the full width of the page, so nothing leaves paper empty at the sides.
 */

import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import FlowStory from "@/components/issue/FlowStory";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV6({ issue, articles, streamingArticleIds }: IssueLayoutProps) {
  const [main, ...rest] = articles;

  return (
    <>
      {main && (
        <div className="border-y-4 border-double border-ink pt-4 pb-6 mb-6 text-center">
          <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-stone-500">
            Extra · {main.category} · {issue.dateLabel}
          </span>
          <a href={articleHref()}>
            <h1 className="font-headline text-6xl md:text-8xl font-black uppercase leading-[0.95] mt-4 hover:opacity-80 transition-opacity">
              {main.title}
            </h1>
          </a>
          {main.deck && <p className="font-headline italic text-xl text-ink-light mt-3 max-w-4xl mx-auto">{main.deck}</p>}
        </div>
      )}

      {main && (
        <div className="issue-flow columns-1 md:columns-2 lg:columns-3 gap-10">
          <ArticleImage image={main.image} eager className="mb-4" />
          <ArticleBody article={main} className="text-base font-body leading-relaxed justified-text text-ink drop-cap" />
          {streamingArticleIds?.has(main.id) && <span className="typing-cursor" />}
        </div>
      )}

      {rest.length > 0 && (
        <section className="mt-8 border-t-4 border-double border-ink pt-3">
          <h3 className="font-sans text-center text-xs font-bold uppercase tracking-[0.3em] mb-5">Also in This Issue</h3>
          <div className="issue-flow columns-1 sm:columns-2 lg:columns-4 gap-8">
            {rest.map((article, index) => (
              <FlowStory
                key={article.id}
                article={article}
                streaming={streamingArticleIds?.has(article.id)}
                kicker={`${String(index + 2).padStart(2, "0")} · ${article.category}`}
                bodyClass="text-xs leading-snug text-ink-light"
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
