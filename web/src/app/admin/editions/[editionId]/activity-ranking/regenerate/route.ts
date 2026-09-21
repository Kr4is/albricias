/**
 * Retry the Activity Ranking article when the edition has GitHub activity
 * but never got one — the backend half of the edit page's durable "failed,
 * retry" card for it. Activity Ranking is generated automatically in
 * `populateEditionDraft`; this is its only retry path now that the manual
 * Rankings page is gone (see `computeMissingGenerationPieces` in
 * `@/lib/generation`). Same async `after()` shape as the section/
 * topic-candidate retry routes, for the same reason: durable across a
 * reload instead of only living in one page load's disabled-button state.
 */

import { after, type NextRequest } from "next/server";
import { beginActivityRankingRetry, finishActivityRankingRetry } from "@/lib/generation";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const eId = Number(editionId);
  const editPath = `/admin/editions/${eId}/edit`;

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, editPath, [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const begun = await beginActivityRankingRetry(eId);
  if (!begun.ok) {
    return flashRedirect(request, editPath, [{ type: "warning", text: begun.reason }]);
  }

  after(async () => {
    await finishActivityRankingRetry(eId, aiModel);
  });

  return flashRedirect(request, editPath, [
    { type: "info", text: "Regenerating Activity Ranking — this page will update automatically." },
  ]);
}
