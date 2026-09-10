/**
 * "Generate edition" — ported from `admin.edition_generate`
 * (`app/routes/admin.py:99-235`), generalised from a fixed month/year to the
 * active cadence's period, and extended with the blog RSS source (Phase 2).
 *
 * The actual generation pipeline (fetch GitHub+blog+Spotify activity, create
 * the `Edition`, run AI generation) now lives in `@/lib/generation`'s
 * `createDraftEdition` + `populateEditionDraft` (split out of the single
 * `runEditionGeneration` the cron scheduler still uses). This route creates
 * the draft edition synchronously (fast — one INSERT) and redirects to it
 * immediately, then runs the slow half via `after()` so the admin lands on
 * the edition page and watches activity/articles appear as they're
 * generated, instead of staring at a blocked tab for however long the
 * configured AI provider takes (which can be minutes with a local Ollama
 * model) — see `/admin/editions/[editionId]/edit/page.tsx`'s polling banner.
 */

import { after, type NextRequest } from "next/server";
import { getCadence, resolvePeriodFromForm } from "@/lib/cadence";
import { periodLabel } from "@/lib/edition-helpers";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import {
  appendGenerationMessages,
  createDraftEdition,
  populateEditionDraft,
} from "@/lib/generation";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const cadence = await getCadence();

  let period;
  try {
    period = resolvePeriodFromForm(form, cadence);
  } catch (error) {
    return flashRedirect(request, "/admin/editions", [
      { type: "error", text: describeError(error) },
    ]);
  }

  // Fail fast before writing anything: without a provider the background half
  // would create a draft edition and then silently skip every AI step, which
  // reads as "generation did nothing". Same synchronous check the per-article
  // route does (`.../articles/generate/run/route.ts`).
  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, "/admin/editions", [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const created = await createDraftEdition(cadence, period.periodStart, period.periodEnd);

  if (created.status === "exists") {
    return flashRedirect(request, `/admin/editions/${created.edition.id}/edit`, [
      {
        type: "info",
        text: `An edition for ${periodLabel({ cadence, ...period })} already exists.`,
      },
    ]);
  }

  const edition = created.edition;
  after(async () => {
    try {
      await populateEditionDraft(edition, period.periodStart, period.periodEnd);
    } catch (error) {
      console.error(`[admin] Background generation failed for edition ${edition.id}:`, error);
      // The admin is on the edition page by now, not on this response — a
      // server-console line is invisible to them, so the failure also goes on
      // the row the edit page reads.
      await appendGenerationMessages(edition.id, [
        { type: "error", text: `Generation failed: ${describeError(error)}` },
      ]);
    }
  });

  return flashRedirect(request, `/admin/editions/${edition.id}/edit`, [
    { type: "info", text: "Generating your edition — this page will update automatically." },
  ]);
}
