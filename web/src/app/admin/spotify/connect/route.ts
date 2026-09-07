/** Ported from `admin.spotify_connect` (`app/routes/admin.py:622-636`). */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthUrl } from "@/lib/sources";
import { getSetting } from "@/lib/config/settings";
import { flashRedirect } from "@/lib/flash";

export async function GET(request: NextRequest) {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("integrations.spotify.clientId"),
    getSetting("integrations.spotify.clientSecret", { encrypted: true }),
  ]);
  if (!clientId || !clientSecret) {
    return flashRedirect(request, "/admin/editions", [
      {
        type: "error",
        text: "Spotify client ID and secret are not configured — set them at /admin/settings before connecting Spotify.",
      },
    ]);
  }

  return NextResponse.redirect(await getAuthUrl());
}
