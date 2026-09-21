/**
 * Retry a single topic candidate (including a starred repo — `kind: "star"`)
 * that qualified for auto-generation but never got its article — the
 * backend half of the edit page's per-candidate "failed, retry" card.
 * Sibling of `.../topic-candidates/[candidateId]/toggle/route.ts`.
 *
 * Async like `.../editions/generate/route.ts` — see
 * `.../sections/[category]/regenerate/route.ts`'s doc comment for why: the
 * response comes back as soon as the edition flips to
 * `generationStatus: "running"`, and the actual (potentially minutes-long)
 * regeneration runs in `after()`, so the "in progress" state is durable
 * across a reload instead of living only in this one page load's DOM.
 */

import { after, type NextRequest } from "next/server";
import { beginTopicCandidateRetry, finishTopicCandidateRetry } from "@/lib/generation";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; candidateId: string }> },
) {
  const { editionId, candidateId } = await params;
  const eId = Number(editionId);
  const editPath = `/admin/editions/${eId}/edit#github-insights`;

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, editPath, [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const begun = await beginTopicCandidateRetry(eId, candidateId);
  if (!begun.ok) {
    return flashRedirect(request, editPath, [{ type: "warning", text: begun.reason }]);
  }

  after(async () => {
    await finishTopicCandidateRetry(eId, candidateId, aiModel);
  });

  return flashRedirect(request, editPath, [
    { type: "info", text: "Regenerating topic candidate — this page will update automatically." },
  ]);
}
