"use client";

/**
 * An article body's rendered HTML, plus the charts drawn into it. Owns the
 * ref `ArticleCharts` needs to scope its DOM search to this article, and
 * marks the first letter for a `drop-cap` body.
 */

import { useRef } from "react";
import ArticleCharts from "./ArticleCharts";

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

export default function ArticleBody({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const dropCap = /(^|\s)drop-cap(\s|$)/.test(className ?? "");
  return (
    <>
      <div
        ref={ref}
        className={`article-body ${className ?? ""}`}
        dangerouslySetInnerHTML={{ __html: dropCap ? markDropCap(html) : html }}
      />
      <ArticleCharts containerRef={ref} />
    </>
  );
}
