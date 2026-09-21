/**
 * Retry a single chronicle section that had activity but never got a
 * written article (bad AI provider, transient failure, etc.) — the backend
 * half of the edit page's per-section "failed, retry" card.
 *
 * Async like `.../editions/generate/route.ts`: the response comes back as
 * soon as the edition flips to `generationStatus: "running"`, and the
 * actual (potentially minutes-long, against a slow self-hosted model)
 * regeneration runs in `after()`. That's what makes the "in progress" state
 * durable — `GenerationWatcher`/the edit page read it straight off the
 * `Edition` row, so it survives a reload or navigating away and back,
 * unlike a client-side "this button is now disabled" state tied to one page
 * load. See `beginChronicleSectionRetry`/`finishChronicleSectionRetry` in
 * `@/lib/generation`.
 */

import { after, type NextRequest } from "next/server";
import { CATEGORIES, type ChronicleCategory } from "@/mastra/workflows";
import { beginChronicleSectionRetry, finishChronicleSectionRetry } from "@/lib/generation";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { flashRedirect } from "@/lib/flash";

function isChronicleCategory(value: string): value is ChronicleCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; category: string }> },
) {
  const { editionId, category: rawCategory } = await params;
  const eId = Number(editionId);
  const category = decodeURIComponent(rawCategory);
  const editPath = `/admin/editions/${eId}/edit`;

  if (!isChronicleCategory(category)) {
    return new Response("Not found", { status: 404 });
  }

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, editPath, [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const begun = await beginChronicleSectionRetry(eId, category);
  if (!begun.ok) {
    return flashRedirect(request, editPath, [{ type: "warning", text: begun.reason }]);
  }

  after(async () => {
    await finishChronicleSectionRetry(eId, category, aiModel);
  });

  return flashRedirect(request, editPath, [
    { type: "info", text: `Regenerating "${category}" — this page will update automatically.` },
  ]);
}
