/**
 * Bluesky "connect" — not an OAuth redirect (Bluesky auth for a single
 * personal account is just an identifier + app password), so this is a plain
 * form POST from `/admin/social` straight into a stored `SocialAccount` row.
 */

import type { NextRequest } from "next/server";
import { upsertSocialAccount } from "@/lib/social/store";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const identifier = String(form.get("identifier") ?? "").trim();
  const appPassword = String(form.get("app_password") ?? "").trim();

  if (!identifier || !appPassword) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: "Bluesky identifier and app password are both required." },
    ]);
  }

  await upsertSocialAccount("bluesky", { identifier, appPassword });

  return flashRedirect(request, "/admin/social", [
    { type: "success", text: "Bluesky connected successfully." },
  ]);
}
