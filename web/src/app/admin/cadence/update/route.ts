/** POST half of the cadence setting form at `/admin/cadence`. */

import type { NextRequest } from "next/server";
import { setCadence } from "@/lib/cadence";
import { CADENCE_MONTHLY, CADENCE_WEEKLY } from "@/lib/edition-helpers";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const value = form.get("cadence")?.toString();

  if (value !== CADENCE_WEEKLY && value !== CADENCE_MONTHLY) {
    return flashRedirect(request, "/admin/cadence", [
      { type: "error", text: "Invalid cadence." },
    ]);
  }

  await setCadence(value);

  return flashRedirect(request, "/admin/cadence", [
    { type: "success", text: `Cadence set to ${value}.` },
  ]);
}
