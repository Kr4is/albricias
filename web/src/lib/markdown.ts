/**
 * Markdown rendering for article bodies, replacing Jinja's `| markdown | safe`
 * filter (`app/extensions.py:14-16`, python-markdown with the `fenced_code`
 * and `tables` extensions).
 *
 * `marked` covers both of those out of the box (GFM fenced code + tables).
 * Like the Flask original the output is trusted and injected unescaped —
 * article bodies are written by the single admin user or produced by the
 * generation pipeline, never by anonymous visitors.
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
