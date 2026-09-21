/**
 * "Generate edition" — ported from `admin.edition_generate`
 * (`app/routes/admin.py:99-235`), generalised from a fixed month/year to the
 * active cadence's period, and extended with the blog RSS source (Phase 2).
 *
 * Under the daily-incremental model (`@/lib/generation/daily`), this button
 * no longer runs one whole-period batch — it creates the draft edition if
 * needed (`createDraftEdition`, fast — one INSERT) and redirects to it
 * immediately, then catches it up day by day via `after()`
 * (`processMissedDays`, the same function the daily cron itself calls), all
 * the way to today or the period's end. That's what makes "Generate
 * edition" a legitimate on-demand/backfill action even though daily
 * processing is normally automatic: it's "catch this edition up right now"
 * rather than a separate code path. The admin lands on the edition page and
 * watches dispatches/articles appear as each day finishes, instead of
 * staring at a blocked tab for however long the configured AI provider
 * takes (which can be minutes per call with a local Ollama model) — see
 * `/admin/editions/[editionId]/edit/page.tsx`'s polling banner.
 */

import { after, type NextRequest } from "next/server";
import { getCadence, resolvePeriodFromForm } from "@/lib/cadence";
import { periodLabel } from "@/lib/edition-helpers";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { createDraftEdition } from "@/lib/generation";
import { processMissedDays } from "@/lib/generation/daily";
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
      await processMissedDays(edition, aiModel);
    } catch (error) {
      // processMissedDays already catches and records its own per-day
      // warnings internally — reaching here means something outside that
      // (a bug, not a generation failure) threw. The admin is on the
      // edition page by now, not on this response, so a server-console
      // line alone would be invisible to them; there is no
      // `appendGenerationMessages` equivalent to fall back on here since
      // `processMissedDays` owns `generationProgress` for the whole run,
      // so this is logged for the operator rather than surfaced in the UI.
      console.error(`[admin] Background daily processing failed for edition ${edition.id}:`, error);
    }
  });

  return flashRedirect(request, `/admin/editions/${edition.id}/edit`, [
    { type: "info", text: "Generating your edition — this page will update automatically." },
  ]);
}
