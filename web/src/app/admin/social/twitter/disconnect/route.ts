/** Mirrors `/admin/spotify/disconnect`. */

import type { NextRequest } from "next/server";
import { getSocialAccount, deleteSocialAccount } from "@/lib/social/store";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const account = await getSocialAccount("twitter");
  if (!account) {
    return flashRedirect(request, "/admin/social", [
      { type: "info", text: "X was not connected." },
    ]);
  }

  await deleteSocialAccount("twitter");

  return flashRedirect(request, "/admin/social", [
    { type: "success", text: "X disconnected." },
  ]);
}
