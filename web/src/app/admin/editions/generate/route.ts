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
import { createDraftEdition, populateEditionDraft } from "@/lib/generation";
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
    }
  });

  return flashRedirect(request, `/admin/editions/${edition.id}/edit`, [
    { type: "info", text: "Generating your edition — this page will update automatically." },
  ]);
}
