/** POST half of `/admin/settings`'s Google Calendar form. */

import type { NextRequest } from "next/server";
import { flashRedirect } from "@/lib/flash";
import { saveFields } from "../save-fields";
import { findCategory } from "../field-specs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  await saveFields(form, findCategory("google")!.fields);

  return flashRedirect(request, "/admin/settings", [
    { type: "success", text: "Google Calendar settings saved." },
  ]);
}
