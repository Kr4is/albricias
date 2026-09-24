/**
 * Markdown rendering for article bodies — GFM (fenced code, tables) via
 * `marked`. The output is injected unescaped: every body is written by the
 * generation pipeline from the visitor's own GitHub activity, never typed
 * in by an anonymous third party.
 *
 * One addition on top of stock GFM: a ` ```chart ` fenced block (see
 * `@/lib/article-chart` for the JSON contract inside it, and `CHART_CLAUSE`
 * in `@/lib/generation/period-post` for the prompt instruction that tells
 * the writers when to use it) renders as a placeholder `<div data-chart>`
 * instead of a code block — `@/components/ArticleCharts` finds those
 * client-side and draws them with Chart.js. A block that fails to parse as
 * a valid chart spec falls through to marked's normal code-block rendering
 * (`return false`), so a malformed one degrades to a visible code block
 * instead of vanishing.
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
