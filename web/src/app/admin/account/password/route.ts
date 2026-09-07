/**
 * Change-admin-password form handler for `/admin/account`. Writes a new DB
 * hash via `setAdminPassword()`; deliberately does not touch
 * `auth.sessionSecret` — see the page's doc comment on why password changes
 * don't rotate other devices' sessions.
 */

import type { NextRequest } from "next/server";
import { setAdminPassword } from "@/lib/config/admin-auth";
import { flashRedirect } from "@/lib/flash";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return flashRedirect(request, "/admin/account", [
      { type: "error", text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
    ]);
  }
  if (password !== confirm) {
    return flashRedirect(request, "/admin/account", [
      { type: "error", text: "Passwords do not match." },
    ]);
  }

  await setAdminPassword(password);

  return flashRedirect(request, "/admin/account", [
    { type: "success", text: "Admin password updated." },
  ]);
}
