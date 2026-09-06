/**
 * Ported from `app/templates/admin/preview_toolbar.html`, rendered at the
 * bottom of every issue layout when `isPreview` is true.
 *
 * Public routes always pass `isPreview={false}`, so this renders nothing there.
 * It exists now so the Phase 3 admin preview route can reuse the same layout
 * components untouched. Its links point at `/admin/*` routes Phase 3 owns; the
 * publish button posts to `/admin/editions/<id>/publish` exactly as the Flask
 * form did.
 */

import { EDITION_STATUS_DRAFT } from "@/lib/edition-helpers";
import type { IssueView } from "@/components/issue/types";

export interface PreviewToolbarProps {
  issue: IssueView;
  isPreview: boolean;
}

export default function PreviewToolbar({
  issue,
  isPreview,
}: PreviewToolbarProps) {
  if (!isPreview) return null;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-ink text-paper no-print">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="material-icons text-amber-400 text-sm">
              visibility
            </span>
            <span className="text-xs font-sans font-bold uppercase tracking-widest text-amber-400">
              Preview Mode
            </span>
            <span className="text-xs font-sans text-stone-400 ml-2">
              — {issue.title}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href={`/admin/editions/${issue.id}/edit`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest border border-stone-500 text-stone-300 hover:border-paper hover:text-paper transition-colors"
            >
              <span className="material-icons text-sm">edit</span> Edit Articles
            </a>
            {issue.status === EDITION_STATUS_DRAFT ? (
              <form method="POST" action={`/admin/editions/${issue.id}/publish`}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-amber-500 text-ink hover:bg-amber-400 transition-colors"
                >
                  <span className="material-icons text-sm">publish</span> Publish
                  Edition
                </button>
              </form>
            ) : (
              <a
                href={`/edition/${issue.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-green-600 text-white hover:bg-green-500 transition-colors"
              >
                <span className="material-icons text-sm">open_in_new</span> View
                Live
              </a>
            )}
            <a
              href="/admin/editions"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest text-stone-400 hover:text-paper transition-colors"
            >
              <span className="material-icons text-sm">arrow_back</span>{" "}
              Dashboard
            </a>
          </div>
        </div>
      </div>
      {/* Spacer so content isn't hidden behind the toolbar */}
      <div className="h-16 no-print"></div>
    </>
  );
}
