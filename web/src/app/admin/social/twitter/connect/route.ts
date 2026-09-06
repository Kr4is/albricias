/**
 * Starts the X (Twitter) OAuth 2.0 + PKCE connect flow — mirrors
 * `/admin/spotify/connect`'s shape (env-var precheck, then redirect to the
 * network's own authorize page).
 *
 * The PKCE `codeVerifier`/`state` pair has nowhere else to live between this
 * redirect and the callback (there's no per-flow session store in this app),
 * so it's carried in a short-lived, httpOnly cookie — the standard place for
 * PKCE state when there's no server-side session.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTwitterAuthUrl } from "@/lib/social/twitter";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session";
import { flashRedirect } from "@/lib/flash";

export const TWITTER_PKCE_COOKIE = "twitter_oauth_pkce";

export async function GET(request: NextRequest) {
  if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
    return flashRedirect(request, "/admin/social", [
      {
        type: "error",
        text: "TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set in .env before connecting X.",
      },
    ]);
  }

  const { url, codeVerifier, state } = getTwitterAuthUrl();
  const response = NextResponse.redirect(url);
  response.cookies.set(
    TWITTER_PKCE_COOKIE,
    JSON.stringify({ codeVerifier, state }),
    { ...SESSION_COOKIE_OPTIONS, maxAge: 600 },
  );
  return response;
}
