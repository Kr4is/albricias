/** Ported from `admin.spotify_connect` (`app/routes/admin.py:622-636`). */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthUrl } from "@/lib/sources";
import { flashRedirect } from "@/lib/flash";

export async function GET(request: NextRequest) {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return flashRedirect(request, "/admin/editions", [
      {
        type: "error",
        text: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env before connecting Spotify.",
      },
    ]);
  }

  return NextResponse.redirect(getAuthUrl());
}
