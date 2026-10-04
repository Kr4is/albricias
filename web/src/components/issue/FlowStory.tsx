/**
 * One story inside a balanced column flow (`.issue-flow`): kicker, picture,
 * headline and body, the way a vertical newspaper page runs one story on
 * from the foot of the last. Shared by the layouts whose stories are set in
 * a flow rather than in a column of their own.
 */

import ArticleBody from "@/components/ArticleBody";
import ArticleImage from "@/components/issue/ArticleImage";
import { articleHref } from "@/lib/issue-view";
import type { IssueArticle } from "@/components/issue/types";

export default function FlowStory({
  article,
  streaming = false,
  kicker = article.category,
  headlineClass = "text-xl",
  bodyClass = "text-sm leading-relaxed text-ink-light",
}: {
  article: IssueArticle;
  streaming?: boolean;
  /** The line above the headline; defaults to the category. */
  kicker?: string;
  headlineClass?: string;
  bodyClass?: string;
}) {
  return (
    <article className="mb-8 last:mb-0">
      <div className="mb-1 border-b border-stone-300 pb-1">
        <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-stone-600">{kicker}</span>
      </div>
      <ArticleImage image={article.image} className="mb-2" />
      <a href={articleHref()}>
        <h3 className={`font-headline font-bold leading-tight mb-2 hover:underline ${headlineClass}`}>{article.title}</h3>
      </a>
      <ArticleBody article={article} className={`font-body justified-text ${bodyClass}`} />
      {streaming && <span className="typing-cursor" />}
    </article>
  );
}
