/**
 * X (Twitter) OAuth 2.0 + PKCE callback — exchanges the authorization code
 * for a token pair and stores it as a `SocialAccount` (service: "twitter").
 * Mirrors `/admin/spotify/callback`'s shape.
 */

import type { NextRequest } from "next/server";
import { exchangeTwitterCode } from "@/lib/social/twitter";
import { upsertSocialAccount } from "@/lib/social/store";
import { describeError, flashRedirect } from "@/lib/flash";
import { TWITTER_PKCE_COOKIE } from "../connect/route";

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: `X authorization denied: ${error}` },
    ]);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: "X callback received no authorization code." },
    ]);
  }

  const cookieValue = request.cookies.get(TWITTER_PKCE_COOKIE)?.value;
  if (!cookieValue) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: "X connect session expired — please try connecting again." },
    ]);
  }

  let pkce: { codeVerifier: string; state: string };
  try {
    pkce = JSON.parse(cookieValue);
  } catch {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: "X connect session was invalid — please try connecting again." },
    ]);
  }

  if (pkce.state !== state) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: "X connect state mismatch — please try connecting again." },
    ]);
  }

  try {
    const token = await exchangeTwitterCode(code, pkce.codeVerifier);
    await upsertSocialAccount("twitter", {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    });
    const response = flashRedirect(request, "/admin/social", [
      { type: "success", text: "X connected successfully." },
    ]);
    response.cookies.delete(TWITTER_PKCE_COOKIE);
    return response;
  } catch (err) {
    return flashRedirect(request, "/admin/social", [
      { type: "error", text: `X token exchange failed: ${describeError(err)}` },
    ]);
  }
}
