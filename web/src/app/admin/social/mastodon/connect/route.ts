/**
 * Mastodon "connect" — not an OAuth redirect (the admin generates an
 * application access token themselves from their own instance's
 * Settings > Development screen), so this is a plain form POST from
 * `/admin/social` straight into a stored `SocialAccount` row.
 */

import type { NextRequest } from "next/server";
import { upsertSocialAccount } from "@/lib/social/store";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const instanceUrl = String(form.get("instance_url") ?? "").trim();
  const accessToken = String(form.get("access_token") ?? "").trim();

  if (!instanceUrl || !accessToken) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: "Mastodon instance URL and access token are both required." },
    ]);
  }

  await upsertSocialAccount("mastodon", { instanceUrl, accessToken });

  return flashRedirect(request, "/admin/social", [
    { type: "success", text: "Mastodon connected successfully." },
  ]);
}
