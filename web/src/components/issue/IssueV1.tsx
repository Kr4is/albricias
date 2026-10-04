/**
 * V1 — the banner: the vertical front page of the early New York Times. One
 * lead headline runs the whole width of the sheet over a single flow of
 * narrow columns; the lead's copy opens the flow and every other story
 * follows on from it, each under its own headline, with no story boxed into
 * a column of its own. It's one CSS multi-column flow (`.issue-flow`), so the
 * columns end on the same line however many stories there are.
 */

import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import FlowStory from "@/components/issue/FlowStory";
import { articleHref } from "@/lib/issue-view";
import type { IssueLayoutProps } from "@/components/issue/types";

export default function IssueV1({ issue, articles, streamingArticleIds }: IssueLayoutProps) {
  const [lead, ...rest] = articles;

  return (
    <>
      {lead && (
        <div className="text-center border-b-4 border-double border-ink pb-5 mb-5">
          <div className="border-y border-ink py-1 mb-4 flex items-center">
            <span className="flex-1 font-sans text-[10px] font-bold uppercase tracking-widest">{lead.category}</span>
            <span className="w-px h-3 bg-ink mx-2" />
            <span className="flex-1 font-sans text-[10px] font-bold uppercase tracking-widest">{issue.dateLabel}</span>
          </div>
          <a href={articleHref()}>
            <h1 className="font-headline text-5xl md:text-7xl lg:text-8xl font-black uppercase leading-[0.95] tracking-tight hover:opacity-80 transition-opacity">
              {lead.title}
            </h1>
          </a>
          {lead.deck && <p className="font-headline italic text-lg md:text-xl text-ink-light mt-3 max-w-4xl mx-auto">{lead.deck}</p>}
        </div>
      )}

      <div className="issue-flow columns-1 sm:columns-2 md:columns-3 lg:columns-6 gap-6">
        {lead && (
          <article className="mb-8">
            <ArticleImage image={lead.image} eager className="mb-3" />
            <ArticleBody article={lead} className="text-sm font-body leading-relaxed justified-text text-ink drop-cap" />
            {streamingArticleIds?.has(lead.id) && <span className="typing-cursor" />}
          </article>
        )}
        {rest.map((article) => (
          <FlowStory
            key={article.id}
            article={article}
            streaming={streamingArticleIds?.has(article.id)}
            bodyClass="text-xs leading-snug text-ink-light"
            headlineClass="text-lg"
          />
        ))}
      </div>
    </>
  );
}
