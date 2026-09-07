/**
 * Starts the X (Twitter) OAuth 2.0 + PKCE connect flow — mirrors
 * `/admin/spotify/connect`'s shape (DB-setting precheck, then redirect to
 * the network's own authorize page).
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
import { getSetting } from "@/lib/config/settings";
import { flashRedirect } from "@/lib/flash";

export const TWITTER_PKCE_COOKIE = "twitter_oauth_pkce";

export async function GET(request: NextRequest) {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("integrations.twitter.clientId"),
    getSetting("integrations.twitter.clientSecret", { encrypted: true }),
  ]);
  if (!clientId || !clientSecret) {
    return flashRedirect(request, "/admin/social", [
      {
        type: "error",
        text: "X (Twitter) client ID and secret are not configured — set them at /admin/settings before connecting X.",
      },
    ]);
  }

  const { url, codeVerifier, state } = await getTwitterAuthUrl();
  const response = NextResponse.redirect(url);
  response.cookies.set(
    TWITTER_PKCE_COOKIE,
    JSON.stringify({ codeVerifier, state }),
    { ...SESSION_COOKIE_OPTIONS, maxAge: 600 },
  );
  return response;
}
