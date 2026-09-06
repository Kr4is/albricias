/**
 * "Generate edition" — ported from `admin.edition_generate`
 * (`app/routes/admin.py:99-235`), generalised from a fixed month/year to the
 * active cadence's period, and extended with the blog RSS source (Phase 2).
 *
 * The actual generation pipeline (fetch GitHub+blog+Spotify activity, create
 * the `Edition`, run AI generation) now lives in
 * `@/lib/generation`'s `runEditionGeneration` (Phase A / scheduler), shared
 * with the cron scheduler (`@/lib/scheduler`). This route is a thin wrapper:
 * resolve the period from the submitted form, call the shared pipeline, and
 * redirect with flash messages — identical behaviour to before the extraction.
 */

import type { NextRequest } from "next/server";
import { getCadence, resolvePeriodFromForm } from "@/lib/cadence";
import { periodLabel } from "@/lib/edition-helpers";
import { runEditionGeneration } from "@/lib/generation";
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

  const outcome = await runEditionGeneration(cadence, period.periodStart, period.periodEnd);

  if (outcome.status === "exists") {
    return flashRedirect(request, `/admin/editions/${outcome.edition.id}/edit`, [
      {
        type: "info",
        text: `An edition for ${periodLabel({ cadence, ...period })} already exists.`,
      },
    ]);
  }

  return flashRedirect(request, `/admin/editions/${outcome.edition.id}/edit`, outcome.messages);
}
