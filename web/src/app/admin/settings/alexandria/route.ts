/** POST half of `/admin/settings`'s Alexandria form. */

import type { NextRequest } from "next/server";
import { flashRedirect } from "@/lib/flash";
import { saveFields } from "../save-fields";
import { findCategory } from "../field-specs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  await saveFields(form, findCategory("alexandria")!.fields);

  return flashRedirect(request, "/admin/settings", [
    { type: "success", text: "Alexandria settings saved." },
  ]);
}
