/**
 * POST half of the blank-edition form at `/admin/editions/new`
 * (`admin.edition_new` in `app/routes/admin.py:64-96`).
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { EDITION_STATUS_DRAFT, periodLabel } from "@/lib/edition-helpers";
import { defaultEditionTitle, defaultEditionVol, getCadence, resolvePeriodFromForm } from "@/lib/cadence";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const cadence = await getCadence();

  let period;
  try {
    period = resolvePeriodFromForm(form, cadence);
  } catch (error) {
    return flashRedirect(request, "/admin/editions/new", [
      { type: "error", text: describeError(error) },
    ]);
  }

  const existing = await prisma.edition.findUnique({
    where: { cadence_periodStart: { cadence, periodStart: period.periodStart } },
  });
  if (existing) {
    return flashRedirect(request, `/admin/editions/${existing.id}/edit`, [
      { type: "error", text: `An edition for ${periodLabel({ cadence, ...period })} already exists.` },
    ]);
  }

  const shape = { cadence, ...period };
  const edition = await prisma.edition.create({
    data: {
      cadence,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      title: defaultEditionTitle(shape),
      vol: defaultEditionVol(shape),
      status: EDITION_STATUS_DRAFT,
    },
  });

  return flashRedirect(request, `/admin/editions/${edition.id}/edit`, [
    { type: "success", text: `Draft edition '${edition.title}' created.` },
  ]);
}
