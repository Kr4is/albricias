/**
 * Edition preview — ported from `admin.edition_preview`
 * (`app/routes/admin.py:278-319`), reusing the Phase 4 `IssueLayout` +
 * `PreviewToolbar` components with `isPreview={true}` exactly as suggested
 * in the Phase 4 notes.
 *
 * Unlike the public `/edition/[editionId]` route, prev/next here are not
 * filtered to published editions — draft and published editions are both
 * navigable, matching the original's unfiltered `Edition.query`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import IssueLayout from "@/components/issue/IssueLayout";
import { editionArticles, editionById, nextEdition, previousEdition } from "@/lib/editions";
import { toEditionHeaderInfo, toIssueArticle, toIssueNavRef, toIssueView } from "@/lib/issue-view";
import { layoutIndex } from "@/lib/layout";
import { periodLabel } from "@/lib/edition-helpers";

export const dynamic = "force-dynamic";

/** Flask's `<int:...>` converter: digits only. */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function loadEdition(editionId: string) {
  const id = parseId(editionId);
  if (id === null) return null;
  return editionById(id);
}

export async function generateMetadata({
  params,
}: PageProps<"/admin/editions/[editionId]/preview">): Promise<Metadata> {
  const { editionId } = await params;
  const edition = await loadEdition(editionId);
  return { title: edition ? `Preview: ${periodLabel(edition)} - Admin` : "Edition Not Found - Admin" };
}

export default async function EditionPreviewPage({
  params,
}: PageProps<"/admin/editions/[editionId]/preview">) {
  const { editionId } = await params;
  const edition = await loadEdition(editionId);
  if (edition === null) notFound();

  const [articles, prevEd, nextEd] = await Promise.all([
    editionArticles(edition.id),
    previousEdition(edition.periodStart),
    nextEdition(edition.periodStart),
  ]);

  return (
    <NewspaperShell endpoint="admin.edition_preview" issue={toEditionHeaderInfo(edition)}>
      <IssueLayout
        layout={layoutIndex(edition)}
        issue={toIssueView(edition)}
        articles={articles.map(toIssueArticle)}
        prevIssue={prevEd ? toIssueNavRef(prevEd) : null}
        nextIssue={nextEd ? toIssueNavRef(nextEd) : null}
        isCurrentIssue={false}
        isPreview={true}
      />
    </NewspaperShell>
  );
}
