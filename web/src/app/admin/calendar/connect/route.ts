/** Mirrors `/admin/spotify/connect`'s shape for the Google OAuth flow. */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getGoogleAuthUrl } from "@/lib/sources";
import { getSetting } from "@/lib/config/settings";
import { flashRedirect } from "@/lib/flash";

export async function GET(request: NextRequest) {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("integrations.google.clientId"),
    getSetting("integrations.google.clientSecret", { encrypted: true }),
  ]);
  if (!clientId || !clientSecret) {
    return flashRedirect(request, "/admin/calendar", [
      {
        type: "error",
        text: "Google client ID and secret are not configured — set them at /admin/settings before connecting Google Calendar.",
      },
    ]);
  }

  return NextResponse.redirect(await getGoogleAuthUrl());
}
