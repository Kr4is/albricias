"use client";

/**
 * `/dev/layouts?layout=1&n=5` — one layout on `n` made-up articles, run
 * through the same page-fill pass the generator uses, with the export
 * buttons. `layout` omitted: the layout the generator itself would pick;
 * `repick=1`: the page may switch away from `layout`, as the generator does;
 * `charts=1`: some articles carry a chart. `sample=N`: the Nth invented
 * edition of `lib/sample-editions.ts` instead, in its own layout.
 */

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import IssueLayout from "@/components/issue/IssueLayout";
import ExportActions from "@/components/ExportActions";
import { usePageFill } from "@/components/usePageFill";
import { fixtureArticles } from "@/lib/dev-fixture";
import { SAMPLE_EDITIONS } from "@/lib/sample-editions";
import { pickLayoutForContent, type LayoutIndex } from "@/lib/layout";

export default function LayoutFixture() {
  const params = useSearchParams();
  const sample = SAMPLE_EDITIONS[Number(params.get("sample")) - 1];
  const count = sample ? sample.articles.length : Math.max(1, Math.min(12, Number(params.get("n")) || 5));
  const requested = sample ? sample.layout : Number(params.get("layout"));
  const [layout, setLayout] = useState<LayoutIndex>(() => (requested >= 1 && requested <= 6 ? (requested as LayoutIndex) : pickLayoutForContent(count)));
  const [fold, setFold] = useState<number | null>(null);
  const articles = sample ? sample.articles : fixtureArticles(count, params.get("charts") === "1");
  const ref = useRef<HTMLDivElement>(null);
  const edition = sample?.edition ?? { vol: "VOL. 2026 NO. 9", dateLabel: "September 2026", weather: "Crisp, 12°C" };

  usePageFill({
    ref,
    active: true,
    layout,
    total: count,
    // A layout asked for by number is measured as it is, unless `repick=1` lets the page swap it as the generator would.
    allowRepick: params.get("repick") === "1" || !(requested >= 1 && requested <= 6),
    onRepick: setLayout,
    onFold: setFold,
  });

  return (
    <div>
      <div className="mb-6 no-print">
        <ExportActions targetRef={ref} filename="fixture.png" title="Fixture" edition={edition} version={`${layout}:${count}:${fold}`} />
      </div>
      <div ref={ref} className="issue-page" data-layout={layout}>
        <IssueLayout layout={layout} issue={{ dateLabel: edition.dateLabel }} articles={articles} fold={fold} />
      </div>
    </div>
  );
}
