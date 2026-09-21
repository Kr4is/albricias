/**
 * Markdown rendering for article bodies, replacing Jinja's `| markdown | safe`
 * filter (`app/extensions.py:14-16`, python-markdown with the `fenced_code`
 * and `tables` extensions).
 *
 * `marked` covers both of those out of the box (GFM fenced code + tables).
 * Like the Flask original the output is trusted and injected unescaped —
 * article bodies are written by the single admin user or produced by the
 * generation pipeline, never by anonymous visitors.
 *
 * One addition on top of stock GFM: a ` ```chart ` fenced block (see
 * `@/lib/article-chart` for the JSON contract inside it, and `CHART_CLAUSE`
 * in `@/mastra/agents` for the prompt instruction that tells generators when
 * to use it) renders as a placeholder `<div data-chart>` instead of a code
 * block — `@/components/ArticleCharts` finds those client-side and draws
 * them with Chart.js. A block that fails to parse as a valid chart spec
 * falls through to marked's normal code-block rendering (`return false`),
 * so a malformed one degrades to a visible code block instead of vanishing.
 */

import { Marked } from "marked";
import { parseArticleChartSpec } from "./article-chart";

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
});

marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang !== "chart") return false;
      const spec = parseArticleChartSpec(text);
      if (!spec) return false;
      const encoded = Buffer.from(JSON.stringify(spec), "utf-8").toString("base64");
      return `<div class="article-chart" data-chart="${encoded}"></div>`;
    },
  },
});

export function renderMarkdown(text: string | null | undefined): string {
  return marked.parse(text ?? "") as string;
}

/**
 * Strip common Markdown formatting down to plain text — for anywhere a
 * short excerpt or a narration script needs the words without the syntax,
 * as opposed to `renderMarkdown()`'s full HTML for a page. Originally
 * TTS-only (`@/lib/tts.ts`); moved here once the front-page issue layouts
 * needed the same thing for article teasers, so both have one definition.
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks (chart blocks included)
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/^\|.*\|[ \t]*$/gm, "") // GFM table rows (header, separator, and data rows alike — meaningless without their column headers once truncated into a teaser)
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2") // bold+italic
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/^\s*([-*_]\s*){3,}$/gm, "") // horizontal rules
    .replace(/^\s*[-*+]\s+/gm, "") // bullet list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/\n{3,}/g, "\n\n") // collapse extra blank lines
    .trim();
}

/**
 * A plain-text excerpt of `markdown`, safe to drop into a front-page teaser
 * `<p>` — Markdown syntax stripped first (so `##`/`**`/`` ``` `` never show
 * up literally, the bug this was written to fix), then clipped at the last
 * word boundary before `maxChars` with a trailing ellipsis, only when it was
 * actually truncated.
 */
export function excerpt(markdown: string | null | undefined, maxChars: number): string {
  const plain = stripMarkdown(markdown ?? "").replace(/\s+/g, " ").trim();
  if (plain.length <= maxChars) return plain;
  const clipped = plain.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}
