/**
 * Edition detail — one published edition in its rotating layout.
 * Ported from `public.edition_detail` (`app/routes/public.py:162-204`).
 *
 * Flask's `<int:edition_id>` converter 404s on a non-integer segment; the
 * explicit parse below does the same.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import IssueLayout from "@/components/issue/IssueLayout";
import {
  editionArticles,
  editionById,
  nextPublishedEdition,
  previousPublishedEdition,
} from "@/lib/editions";
import {
  toEditionHeaderInfo,
  toIssueArticle,
  toIssueNavRef,
  toIssueView,
} from "@/lib/issue-view";
import { layoutIndex } from "@/lib/layout";
import { isPublished, periodLabel } from "@/lib/edition-helpers";

export const dynamic = "force-dynamic";

/** Flask's `<int:...>` converter: digits only, no sign, no whitespace. */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function loadEdition(editionId: string) {
  const id = parseId(editionId);
  if (id === null) return null;

  const edition = await editionById(id);
  if (edition === null || !isPublished(edition)) return null;
  return edition;
}

export async function generateMetadata({
  params,
}: PageProps<"/edition/[editionId]">): Promise<Metadata> {
  const { editionId } = await params;
  const edition = await loadEdition(editionId);
  return {
    title: edition ? `${periodLabel(edition)} - ¡Albricias!` : "¡Albricias!",
  };
}

export default async function EditionPage({
  params,
}: PageProps<"/edition/[editionId]">) {
  const { editionId } = await params;
  const edition = await loadEdition(editionId);
  if (edition === null) notFound();

  const [articles, prevEdition, nextEdition] = await Promise.all([
    editionArticles(edition.id),
    previousPublishedEdition(edition.periodStart),
    nextPublishedEdition(edition.periodStart),
  ]);

  return (
    <NewspaperShell
      endpoint="public.edition_detail"
      issue={toEditionHeaderInfo(edition)}
    >
      <IssueLayout
        layout={layoutIndex(edition)}
        issue={toIssueView(edition)}
        articles={articles.map(toIssueArticle)}
        prevIssue={prevEdition ? toIssueNavRef(prevEdition) : null}
        nextIssue={nextEdition ? toIssueNavRef(nextEdition) : null}
        isCurrentIssue={false}
        isPreview={false}
      />
    </NewspaperShell>
  );
}
