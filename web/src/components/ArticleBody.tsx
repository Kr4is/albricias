"use client";

/**
 * An article's prose (markdown, rendered to HTML) and then its structured
 * blocks (`@/lib/article-blocks`): charts, a row of facts, repository
 * cards — rendered from data, not parsed out of the text. Marks the first
 * letter for a `drop-cap` body.
 */

import type { IssueArticle } from "@/components/issue/types";
import type { ArticleBlock, Fact, RepoCard } from "@/lib/article-blocks";
import { renderMarkdown } from "@/lib/markdown";
import ArticleChart from "./ArticleChart";

/**
 * The first letter of the body's opening paragraph (plus any leading quote
 * mark or bracket, as `::first-letter` would take), whole HTML entities
 * included so one is never split.
 */
const FIRST_LETTER_RE = /^(\s*<p>(?:<[^>]+>)*)((?:[“"‘'(]|&(?:quot|#39|ldquo|lsquo);)*(?:&[a-z0-9#]+;|[^\s<&]))/i;

/**
 * Wraps that letter in a real `<span class="drop-cap-letter">` for a
 * `drop-cap` body. A `::first-letter` rule looked the same on screen, but
 * `html-to-image` only reproduces `::before`/`::after`, so the drop cap
 * vanished from exported PNGs — a real element survives the export.
 */
function markDropCap(html: string): string {
  return html.replace(FIRST_LETTER_RE, '$1<span class="drop-cap-letter">$2</span>');
}

/** `108000` → `108k`. */
function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
}

function Facts({ items }: { items: Fact[] }) {
  return (
    <dl className="article-facts">
      {items.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
          {fact.note && <dd className="article-facts-note">{fact.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Repos({ items }: { items: RepoCard[] }) {
  return (
    <ul className="article-repos">
      {items.map((repo) => (
        <li key={repo.name}>
          <a href={repo.url} target="_blank" rel="noreferrer" className="article-repos-name">
            {repo.name}
          </a>
          {repo.description && <p className="article-repos-description">{repo.description}</p>}
          <p className="article-repos-meta">
            {[repo.language, repo.stars !== null ? `★ ${compact(repo.stars)}` : null, repo.forks ? `${compact(repo.forks)} forks` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Block({ block }: { block: ArticleBlock }) {
  if (block.type === "chart") return <ArticleChart spec={block.chart} />;
  if (block.type === "facts") return <Facts items={block.items} />;
  return <Repos items={block.items} />;
}

export default function ArticleBody({ article, className }: { article: IssueArticle; className?: string }) {
  const dropCap = /(^|\s)drop-cap(\s|$)/.test(className ?? "");
  const html = article.content ? renderMarkdown(article.content) : "";
  const blocks = article.blocks ?? [];
  return (
    <>
      {html && <div className={`article-body ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: dropCap ? markDropCap(html) : html }} />}
      {blocks.length > 0 && (
        <div className="article-blocks">
          {blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      )}
    </>
  );
}
