/**
 * Shows how a profile article's outline→sections generation actually went
 * (`@/mastra/workflows/profile`) — the outline, then one box per section in
 * the order they were actually written, colour-coded by status, each with
 * its own "Retry this section" button — except on a `day-post` trace, whose
 * sections the profile-only retry route cannot regenerate in the right voice.
 * Only ever rendered when
 * `Article.sourceData.generationTrace` is present (the edit page checks),
 * so every other article type's edit page is unaffected.
 *
 * Sections are written strictly one at a time
 * (`PROFILE_SECTION_CONCURRENCY = 1` in `@/mastra/workflows/profile`), so
 * `trace.sections`' own array order *is* the order they ran in — rendered
 * as a left-to-right chain with an arrow between each pair of boxes, plus
 * each one's own duration, rather than a plain grid that doesn't show
 * sequence or timing at all.
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

/** `"12.4s"` / `"1m 03s"` between two ISO timestamps, or `null` if either is missing/invalid. */
function duration(startedAt: string, endedAt: string): string | null {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}

function Arrow() {
  return (
    <span className="flex items-center px-1 text-stone-300 text-lg select-none shrink-0" aria-hidden>
      →
    </span>
  );
}

export default function GenerationTraceGraph({
  editionId,
  articleId,
  trace,
}: {
  editionId: number;
  articleId: number;
  trace: GenerationTrace;
}) {
  const outlineDuration = duration(trace.outline.startedAt, trace.outline.endedAt);
  // The retry route regenerates through the *profile* workflow only
  // (`regenerateProfileSection`), so offering it on a day post would silently
  // rewrite the section in the single-repo-deep-dive voice. Until a day-post
  // section retry exists, point at the whole-post regenerate instead.
  // Absent `workflowId` = a trace written before the field existed, which can
  // only be a profile one.
  const canRetrySection = trace.workflowId !== "day-post";

  return (
    <div className="border border-dashed border-stone-300 p-5">
      <h4 className="text-xs font-sans font-bold uppercase tracking-widest mb-1 border-b border-stone-300 pb-2">
        Generation Trace
      </h4>
      <p className="text-[10px] font-sans text-stone-500 mt-2 mb-4">
        This article was written as an outline, then {trace.sections.length} section
        {trace.sections.length === 1 ? "" : "s"} in order, one AI call each — not one big request.
        The chain below runs left to right in the order each call actually happened.
      </p>

      {/* Outline node */}
      <div className="border border-stone-300 bg-stone-50 p-3 mb-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-sans font-bold uppercase tracking-widest text-stone-500">Outline</p>
          {outlineDuration && (
            <p className="text-[9px] font-sans text-stone-400">{outlineDuration}</p>
          )}
        </div>
        <p className="text-sm font-headline font-bold">{trace.outline.title}</p>
        <p className="text-xs font-sans text-stone-600 mt-1">{trace.outline.premise}</p>
      </div>

      {/* Fan-out connector into the chain below */}
      <div className="flex justify-center">
        <div className="w-px h-4 bg-stone-300" />
      </div>

      {/* Section chain, in execution order, scrolling horizontally rather than wrapping so the arrows stay meaningful */}
      <div className="flex items-stretch overflow-x-auto pb-1">
        {trace.sections.map((section, position) => {
          const style = STATUS_STYLES[section.status];
          const formId = `retry-section-${section.index}-form`;
          const sectionDuration = duration(section.startedAt, section.endedAt);
          return (
            <div key={section.index} className="flex items-stretch shrink-0">
              {position > 0 && <Arrow />}
              <div className={`w-48 border p-3 flex flex-col ${style.border} ${style.bg}`}>
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-sans font-bold text-stone-400">
                      {position + 1}.
                    </span>
                    <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                    <span className={`text-[9px] font-sans font-bold uppercase tracking-widest ${style.label}`}>
                      {section.status}
                    </span>
                  </div>
                  {sectionDuration && (
                    <span className="text-[9px] font-sans text-stone-400">{sectionDuration}</span>
                  )}
                </div>
                <p className="text-xs font-bold font-sans flex-1">{section.heading}</p>
                {section.status === "failed" && section.error && (
                  <p className="text-[10px] font-sans text-red-700 mt-1">{section.error}</p>
                )}
                {canRetrySection ? (
                  <>
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
                  </>
                ) : (
                  <p className="mt-2 text-[9px] font-sans text-stone-500 leading-snug">
                    Use &ldquo;Regenerate post&rdquo; above to rewrite this post.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
