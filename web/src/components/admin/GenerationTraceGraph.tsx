/**
 * Shows how a profile article's outline→sections generation actually went
 * (`@/mastra/workflows/profile`) — the outline, then one box per section,
 * colour-coded by status, each with its own "Retry this section" button.
 * Only ever rendered when `Article.sourceData.generationTrace` is present
 * (the edit page checks), so every other article type's edit page is
 * unaffected.
 *
 * Plain server-rendered HTML/CSS — no graph-rendering library. The retry
 * buttons are ordinary `<form method="POST">`s targeting the sibling
 * `sections/[index]/regenerate` route, the same non-JS-required convention
 * this page's "Regenerate" button already uses; the edit page already picks
 * up the resulting "writing…" live state via the existing `/live` SSE route
 * + `GenerationWatcher`, since a section retry rides the same
 * `Edition.generationStatus` plumbing every other single-piece retry does.
 */

import type { GenerationTrace } from "@/mastra/schemas";

const STATUS_STYLES: Record<"success" | "failed", { border: string; bg: string; label: string; dot: string }> = {
  success: { border: "border-green-300", bg: "bg-green-50", label: "text-green-800", dot: "bg-green-500" },
  failed: { border: "border-red-300", bg: "bg-red-50", label: "text-red-800", dot: "bg-red-500" },
};

export default function GenerationTraceGraph({
  editionId,
  articleId,
  trace,
}: {
  editionId: number;
  articleId: number;
  trace: GenerationTrace;
}) {
  return (
    <div className="border border-dashed border-stone-300 p-5">
      <h4 className="text-xs font-sans font-bold uppercase tracking-widest mb-1 border-b border-stone-300 pb-2">
        Generation Trace
      </h4>
      <p className="text-[10px] font-sans text-stone-500 mt-2 mb-4">
        This article was written as an outline plus {trace.sections.length} section
        {trace.sections.length === 1 ? "" : "s"}, each its own AI call — not one big request.
      </p>

      {/* Outline node */}
      <div className="border border-stone-300 bg-stone-50 p-3 mb-3">
        <p className="text-[9px] font-sans font-bold uppercase tracking-widest text-stone-500">Outline</p>
        <p className="text-sm font-headline font-bold">{trace.outline.title}</p>
        <p className="text-xs font-sans text-stone-600 mt-1">{trace.outline.premise}</p>
      </div>

      {/* Fan-out connector */}
      <div className="flex justify-center">
        <div className="w-px h-4 bg-stone-300" />
      </div>

      {/* Section nodes */}
      <div className="flex flex-wrap gap-3">
        {trace.sections.map((section) => {
          const style = STATUS_STYLES[section.status];
          const formId = `retry-section-${section.index}-form`;
          return (
            <div
              key={section.index}
              className={`flex-1 min-w-[180px] border p-3 ${style.border} ${style.bg}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                <span className={`text-[9px] font-sans font-bold uppercase tracking-widest ${style.label}`}>
                  {section.status}
                </span>
              </div>
              <p className="text-xs font-bold font-sans">{section.heading}</p>
              {section.status === "failed" && section.error && (
                <p className="text-[10px] font-sans text-red-700 mt-1">{section.error}</p>
              )}
              <form
                id={formId}
                method="POST"
                action={`/admin/editions/${editionId}/articles/${articleId}/sections/${section.index}/regenerate`}
                data-loading-submit
              />
              <button
                type="submit"
                form={formId}
                data-loading-text="Retrying…"
                className="mt-2 w-full px-2 py-1.5 text-[9px] font-bold font-sans uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                Retry this section
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
