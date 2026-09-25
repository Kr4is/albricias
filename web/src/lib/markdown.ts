/**
 * Markdown rendering for article bodies — GFM (fenced code, tables) via
 * `marked`. The output is injected unescaped: every body is written by the
 * generation pipeline from the visitor's own GitHub activity, never typed
 * in by an anonymous third party. Charts and other structured blocks don't
 * travel in the markdown; they're data (`@/lib/article-blocks`).
 */

import { Marked } from "marked";

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
});

export function renderMarkdown(text: string | null | undefined): string {
  return marked.parse(text ?? "") as string;
}
