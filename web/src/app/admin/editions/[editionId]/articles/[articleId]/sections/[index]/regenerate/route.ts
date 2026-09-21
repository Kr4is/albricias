/**
 * Retry one section of a profile article's outline→sections generation
 * (`@/mastra/workflows/profile`) — the backend half of the "Retry this
 * section" button on the article edit page's generation-trace graph.
 * Sibling of `.../topic-candidates/[candidateId]/regenerate/route.ts`, same
 * `begin` synchronously / `finish` in `after()` shape — see that route's
 * doc comment for why: the response comes back as soon as the edition
 * flips to `generationStatus: "running"`, and the actual regeneration runs
 * in the background, so "in progress" survives a reload instead of living
 * only in this one page load's DOM.
 */

import { after, type NextRequest } from "next/server";
import { beginArticleSectionRetry, finishArticleSectionRetry } from "@/lib/generation";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; articleId: string; index: string }> },
) {
  const { editionId, articleId, index } = await params;
  const eId = Number(editionId);
  const aId = Number(articleId);
  const sectionIndex = Number(index);
  const editPath = `/admin/editions/${eId}/articles/${aId}/edit`;

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, editPath, [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const begun = await beginArticleSectionRetry(eId, aId, sectionIndex);
  if (!begun.ok) {
    return flashRedirect(request, editPath, [{ type: "warning", text: begun.reason }]);
  }

  after(async () => {
    await finishArticleSectionRetry(eId, aId, sectionIndex, aiModel);
  });

  return flashRedirect(request, editPath, [
    { type: "info", text: "Regenerating section — this page will update automatically." },
  ]);
}
