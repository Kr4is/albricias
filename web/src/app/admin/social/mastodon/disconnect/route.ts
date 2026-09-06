/** Mirrors `/admin/spotify/disconnect`. */

import type { NextRequest } from "next/server";
import { getSocialAccount, deleteSocialAccount } from "@/lib/social/store";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const account = await getSocialAccount("mastodon");
  if (!account) {
    return flashRedirect(request, "/admin/social", [
      { type: "info", text: "Mastodon was not connected." },
    ]);
  }

  await deleteSocialAccount("mastodon");

  return flashRedirect(request, "/admin/social", [
    { type: "success", text: "Mastodon disconnected." },
  ]);
}
