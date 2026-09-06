/**
 * Ported from `admin.spotify_callback` (`app/routes/admin.py:639-670`).
 *
 * Stays under `/admin/*`, so `proxy.ts`'s session-cookie guard still applies
 * (matching the original's `@login_required`) — the browser making this
 * request is the admin's own, redirected here by Spotify, so the session
 * cookie is still present. Only the *bearer-token* API guard
 * (`requireApiToken`) is deliberately not applied here, since it's an
 * external redirect from Spotify and was never token-gated in the original.
 */

import type { NextRequest } from "next/server";
import { exchangeCode } from "@/lib/sources";
import { upsertServiceToken } from "@/lib/service-token";
import { describeError, flashRedirect } from "@/lib/flash";

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return flashRedirect(request, "/admin/editions", [
      { type: "error", text: `Spotify authorization denied: ${error}` },
    ]);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return flashRedirect(request, "/admin/editions", [
      { type: "error", text: "Spotify callback received no authorization code." },
    ]);
  }

  try {
    const tokenData = await exchangeCode(code);
    await upsertServiceToken({
      service: "spotify",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
    });
    return flashRedirect(request, "/admin/editions", [
      { type: "success", text: "Spotify connected successfully." },
    ]);
  } catch (err) {
    return flashRedirect(request, "/admin/editions", [
      { type: "error", text: `Spotify token exchange failed: ${describeError(err)}` },
    ]);
  }
}
