/**
 * "Generate edition" — ported from `admin.edition_generate`
 * (`app/routes/admin.py:99-235`), generalised from a fixed month/year to the
 * active cadence's period, and extended with the blog RSS source (Phase 2).
 *
 * Under the daily-incremental model (`@/lib/generation/daily`), this button
 * no longer runs one whole-period batch — it creates the draft edition if
 * needed (`createDraftEdition`, fast — one INSERT) and redirects to it
 * immediately, then processes the most recently completed day of that period
 * via `after()` (`processYesterdayIfNeeded`, the same function the daily cron
 * itself calls). That's what makes "Generate edition" a legitimate on-demand
 * action even though daily processing is normally automatic: it asks for the
 * one day that's due rather than running a separate code path. The admin
 * lands on the edition page and watches the day's data appear once
 * processing finishes, instead of staring at a blocked tab — see
 * `/admin/editions/[editionId]/edit/page.tsx`'s polling banner.
 *
 * Often there is no such day — a period created on its own first day has no
 * completed day yet — and the flash says so rather than implying work is
 * underway; `dueDayFor` decides which message the redirect carries.
 */

import { after, type NextRequest } from "next/server";
import { getCadence, resolvePeriodFromForm } from "@/lib/cadence";
import { periodLabel } from "@/lib/edition-helpers";
import { createDraftEdition } from "@/lib/generation";
import { dueDayFor, processYesterdayIfNeeded } from "@/lib/generation/daily";
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
  // What the background call will actually do, decided up front by the same
  // rules it uses (`dueDayFor`) — the response has to be written before
  // `after()` runs, so without this the flash claimed generation was underway
  // even when the call was about to no-op (nothing due yet, already caught up).
  const dueDay = dueDayFor(edition);

  after(async () => {
    try {
      await processYesterdayIfNeeded(edition);
    } catch (error) {
      // processYesterdayIfNeeded already catches and records its own
      // per-day warnings internally — reaching here means something
      // outside that (a bug, not a generation failure) threw. The admin is
      // on the edition page by now, not on this response, so a
      // server-console line alone would be invisible to them; there is no
      // `appendGenerationMessages` equivalent to fall back on here since
      // `processYesterdayIfNeeded` owns `generationProgress` for the whole
      // run, so this is logged for the operator rather than surfaced in
      // the UI.
      console.error(`[admin] Background daily processing failed for edition ${edition.id}:`, error);
    }
  });

  return flashRedirect(request, `/admin/editions/${edition.id}/edit`, [
    dueDay === null
      ? {
          type: "info",
          text: `Edition created for ${periodLabel({ cadence, ...period })}. Nothing to process yet — daily processing covers the most recently completed day, and this period has none of its own yet.`,
        }
      : {
          type: "info",
          text: `Edition created. Processing ${dueDay.toISOString().slice(0, 10)} — this page will update automatically.`,
        },
  ]);
}
