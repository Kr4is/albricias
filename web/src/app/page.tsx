/**
 * Home — the latest published edition, rendered in its rotating layout.
 * Ported from `public.home` (`app/routes/public.py:48-81`).
 *
 * With no published edition Flask returned `render_template("404.html"), 404`;
 * `notFound()` renders `src/app/not-found.tsx` with the same status, which is
 * the same 404 page.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import IssueLayout from "@/components/issue/IssueLayout";
import {
  editionArticles,
  latestPublishedEdition,
  previousPublishedEdition,
} from "@/lib/editions";
import {
  toEditionHeaderInfo,
  toIssueArticle,
  toIssueNavRef,
  toIssueView,
} from "@/lib/issue-view";
import { layoutIndex } from "@/lib/layout";
import { periodLabel } from "@/lib/edition-helpers";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const latest = await latestPublishedEdition();
  return {
    title: latest ? `${periodLabel(latest)} - ¡Albricias!` : "¡Albricias!",
  };
}

export default async function HomePage() {
  const latest = await latestPublishedEdition();
  if (latest === null) notFound();

  const [articles, prevEdition] = await Promise.all([
    editionArticles(latest.id),
    previousPublishedEdition(latest.periodStart),
  ]);

  return (
    <NewspaperShell endpoint="public.home" issue={toEditionHeaderInfo(latest)}>
      <IssueLayout
        layout={layoutIndex(latest)}
        issue={toIssueView(latest)}
        articles={articles.map(toIssueArticle)}
        prevIssue={prevEdition ? toIssueNavRef(prevEdition) : null}
        nextIssue={null}
        isCurrentIssue={true}
        isPreview={false}
      />
    </NewspaperShell>
  );
}
