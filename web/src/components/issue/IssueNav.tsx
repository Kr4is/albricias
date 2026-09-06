/** Ported from `app/templates/issue_nav.html` — included by all five layouts. */

import type { IssueNavRef } from "@/components/issue/types";

export interface IssueNavProps {
  prevIssue: IssueNavRef | null;
  nextIssue: IssueNavRef | null;
  isCurrentIssue: boolean;
}

export default function IssueNav({
  prevIssue,
  nextIssue,
  isCurrentIssue,
}: IssueNavProps) {
  if (isCurrentIssue) return null;

  return (
    <div className="flex items-center justify-between mb-6 border-b border-stone-300 pb-4 no-print">
      <a
        href="/archive"
        className="inline-flex items-center text-xs font-bold uppercase tracking-widest text-ink hover:underline"
      >
        <span className="material-icons text-sm mr-1">arrow_back</span>
        Back to Archive
      </a>
      <div className="flex items-center gap-4">
        {prevIssue && (
          <a
            href={`/edition/${prevIssue.id}`}
            className="inline-flex items-center text-xs font-bold uppercase tracking-widest text-stone-500 hover:text-ink transition-colors"
          >
            <span className="material-icons text-sm mr-1">chevron_left</span>
            {prevIssue.dateShortLabel}
          </a>
        )}
        {nextIssue && (
          <a
            href={`/edition/${nextIssue.id}`}
            className="inline-flex items-center text-xs font-bold uppercase tracking-widest text-stone-500 hover:text-ink transition-colors"
          >
            {nextIssue.dateShortLabel}
            <span className="material-icons text-sm ml-1">chevron_right</span>
          </a>
        )}
      </div>
    </div>
  );
}
