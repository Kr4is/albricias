"use client";

/**
 * A sample edition set the way a generated one is: the same layout, run
 * through the same page-fill pass, charts and all. The layout is the
 * sample's own, never swapped.
 */

import { useRef, useState } from "react";
import IssueLayout from "@/components/issue/IssueLayout";
import { usePageFill } from "@/components/usePageFill";
import type { SampleEdition } from "@/lib/sample-editions";

export default function SampleIssue({ sample }: { sample: SampleEdition }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState<number | null>(null);

  usePageFill({
    ref,
    active: true,
    layout: sample.layout,
    total: sample.articles.length,
    allowRepick: false,
    onRepick: () => {},
    onFold: setFold,
  });

  return (
    <div ref={ref} className="issue-page" data-layout={sample.layout}>
      <IssueLayout layout={sample.layout} issue={{ dateLabel: sample.edition.dateLabel }} articles={sample.articles} fold={fold} />
    </div>
  );
}
