"use client";

/**
 * Thin client wrapper around an article body's already-rendered HTML
 * (`renderMarkdown()` stays server-side — only the chart-drawing needs a
 * browser). Owns the one ref `ArticleCharts` needs to scope its DOM search
 * to this article, so the two call sites (the public article page and the
 * admin preview) don't each have to wire that up themselves.
 */

import { useRef } from "react";
import ArticleCharts from "./ArticleCharts";

export default function ArticleBody({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
      <ArticleCharts containerRef={ref} />
    </>
  );
}
