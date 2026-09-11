/**
 * Mark/unmark toggle for one `Edition.topicCandidates` entry — part of the
 * "GitHub Insights" curation UI on `.../edit` (plan Implementation Step 4).
 *
 * Updates `Edition.curatorMarks.topicCandidateIds` and, in the same request,
 * flips `hidden` on whichever `Article` was auto-generated from this
 * candidate (found via `Article.sourceData.topicCandidateId`, plan Step 3) —
 * unmarking hides it from the public edition page without deleting it; the
 * admin can still edit it. `Edition.curatorMarks` and `Article.hidden` are
 * both real columns now (see `prisma/schema.prisma`'s doc comments on both),
 * so reads go straight through `parseStoredCuratorMarks`; the writes still
 * go via `unknown` casts, left as-is rather than widened in an unrelated
 * change.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { flashRedirect } from "@/lib/flash";
import { parseStoredCuratorMarks, type CuratorMarks } from "@/lib/topic-candidates";
import type { TopicCandidate } from "@/lib/topic-candidates/types";

function readTopicCandidates(raw: string | null): TopicCandidate[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TopicCandidate[]) : [];
  } catch {
    return [];
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; candidateId: string }> },
) {
  const { editionId, candidateId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  const candidates = readTopicCandidates(edition.topicCandidates);
  if (!candidates.some((candidate) => candidate.id === candidateId)) {
    return new Response("Not found", { status: 404 });
  }

  const marks = parseStoredCuratorMarks(edition.curatorMarks);

  // Absent `topicCandidateIds` means "every candidate is marked/visible" —
  // the default before any curation (see edit/page.tsx's
  // isTopicCandidateMarked). Materialize the full marked set on the first
  // toggle so everything else stays marked, then flip this one candidate.
  const currentlyMarked = marks.topicCandidateIds ?? candidates.map((candidate) => candidate.id);
  const isCurrentlyMarked = currentlyMarked.includes(candidateId);
  const nextMarked = isCurrentlyMarked
    ? currentlyMarked.filter((cid) => cid !== candidateId)
    : [...currentlyMarked, candidateId];

  const nextMarks: CuratorMarks = { ...marks, topicCandidateIds: nextMarked };

  await (
    prisma.edition.update as unknown as (args: {
      where: { id: number };
      data: { curatorMarks: string };
    }) => Promise<unknown>
  )({ where: { id }, data: { curatorMarks: JSON.stringify(nextMarks) } });

  const isNowMarked = !isCurrentlyMarked;
  const articles = await prisma.article.findMany({ where: { editionId: id } });
  const linkedArticle = articles.find((article) => {
    if (!article.sourceData) return false;
    try {
      const source = JSON.parse(article.sourceData) as { topicCandidateId?: string };
      return source.topicCandidateId === candidateId;
    } catch {
      return false;
    }
  });
  if (linkedArticle) {
    await (
      prisma.article.update as unknown as (args: {
        where: { id: number };
        data: { hidden: boolean };
      }) => Promise<unknown>
    )({ where: { id: linkedArticle.id }, data: { hidden: !isNowMarked } });
  }

  // Back to the `#github-insights` anchor rather than the top of a long edit
  // page, so marking several candidates in a row doesn't lose the curator's
  // place (plan Acceptance Criteria 3, smaller fragment-based variant).
  return flashRedirect(request, `/admin/editions/${id}/edit#github-insights`, [
    {
      type: "success",
      text: isNowMarked ? "Topic candidate marked." : "Topic candidate unmarked.",
    },
  ]);
}
