/**
 * X (Twitter) API v2 posting client.
 *
 * Auth flow chosen: **OAuth 2.0 Authorization Code with PKCE, confidential
 * client** — per X's own current developer docs
 * (https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token),
 * this is the auth flow X recommends for all new development that posts on
 * behalf of a user (OAuth 1.0a is documented as "legacy", kept mainly for
 * media-upload endpoints). As of early 2026 X replaced the old flat free tier
 * with pay-per-use pricing (a small per-post cost) available to any
 * registered developer app — there is no longer a distinct "free tier" auth
 * requirement to special-case; any app created at https://developer.x.com
 * with OAuth 2.0 enabled and the `tweet.read`/`tweet.write`/`offline.access`
 * scopes can use this flow. Checked against current docs at implementation
 * time (2026-09), not training data, per this codebase's established
 * practice for fast-moving external APIs.
 *
 * App credentials are resolved exclusively via `getSetting()`
 * (`@/lib/config/settings.ts`) from values entered at `/admin/settings` —
 * client ID, client secret (confidential client — used for HTTP Basic auth
 * on the token endpoint), and redirect URI (e.g.
 * http://localhost:3000/admin/social/twitter/callback) — no env-var fallback.
 *
 * Credentials are stored in `SocialAccount.credentials` (service: "twitter")
 * as `{ accessToken, refreshToken, expiresAt }` — `expiresAt` is an ISO
 * timestamp, refreshed automatically by {@link postToX} when it has expired
 * (X user-context access tokens are short-lived, ~2 hours; `offline.access`
 * is requested so a refresh token is always issued).
 */

import { createHash, randomBytes } from "node:crypto";
import { getSetting } from "@/lib/config/settings";
import { getSocialAccount, parseCredentials, upsertSocialAccount } from "./store";

const DEFAULT_REDIRECT_URI = "http://localhost:3000/admin/social/twitter/callback";

/** X's documented plain-text post limit. */
export const TWITTER_TEXT_LIMIT = 280;

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const TWEETS_URL = "https://api.x.com/2/tweets";

export const TWITTER_SCOPES = "tweet.read tweet.write users.read offline.access";

async function requireSetting(key: string, encrypted: boolean, label: string): Promise<string> {
  const value = await getSetting(key, { encrypted });
  if (!value) throw new Error(`${label} is not configured. Set it at /admin/settings.`);
  return value;
}

function clientId(): Promise<string> {
  return requireSetting("integrations.twitter.clientId", false, "X/Twitter client ID");
}

function clientSecret(): Promise<string> {
  return requireSetting("integrations.twitter.clientSecret", true, "X/Twitter client secret");
}

function redirectUri(): Promise<string> {
  return getSetting("integrations.twitter.redirectUri", {
    default: DEFAULT_REDIRECT_URI,
  }) as Promise<string>;
}

async function basicAuthHeader(): Promise<string> {
  const [id, secret] = await Promise.all([clientId(), clientSecret()]);
  const raw = `${id}:${secret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface TwitterAuthRequest {
  url: string;
  codeVerifier: string;
  state: string;
}

/**
 * Builds the authorize-redirect URL plus the PKCE `codeVerifier`/`state` the
 * caller must persist (in a short-lived cookie — there's no session store fit
 * for this) until the callback arrives.
 */
export async function getTwitterAuthUrl(): Promise<TwitterAuthRequest> {
  const [id, redirect] = await Promise.all([clientId(), redirectUri()]);
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const state = base64Url(randomBytes(16));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    redirect_uri: redirect,
    scope: TWITTER_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { url: `${AUTHORIZE_URL}?${params.toString()}`, codeVerifier, state };
}

interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function requestToken(body: URLSearchParams): Promise<TwitterTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: await basicAuthHeader(),
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`X token request failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as TwitterTokenResponse;
}

/** Exchanges the authorization `code` (from the callback) for a token pair. */
export async function exchangeTwitterCode(
  code: string,
  codeVerifier: string,
): Promise<TwitterTokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: await redirectUri(),
      code_verifier: codeVerifier,
    }),
  );
}

async function refreshAccessToken(refreshToken: string): Promise<TwitterTokenResponse> {
  return requestToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

interface TwitterCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string; // ISO timestamp
}

/** Same 60-second buffer `@/lib/service-token.ts` uses for Spotify. */
const EXPIRY_BUFFER_MS = 60_000;

function isExpired(credentials: TwitterCredentials): boolean {
  return Date.now() >= new Date(credentials.expiresAt).getTime() - EXPIRY_BUFFER_MS;
}

/**
 * Post `text` to X on behalf of the connected account, refreshing the access
 * token first if it has expired. Returns the new post's public URL.
 *
 * Throws (does not catch) when X isn't connected/enabled, the token can't be
 * refreshed, or the API call itself fails — callers flash the error, matching
 * this codebase's graceful-degradation convention.
 */
export async function postToX(text: string): Promise<{ url: string }> {
  const account = await getSocialAccount("twitter");
  if (!account || !account.enabled) {
    throw new Error("X is not connected. Connect it from /admin/social first.");
  }

  let credentials = parseCredentials<TwitterCredentials>(account);

  if (isExpired(credentials)) {
    if (!credentials.refreshToken) {
      throw new Error("X access token expired and no refresh token is stored — reconnect X.");
    }
    const refreshed = await refreshAccessToken(credentials.refreshToken);
    credentials = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? credentials.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    };
    await upsertSocialAccount("twitter", credentials);
  }

  const response = await fetch(TWEETS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Posting to X failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as { data: { id: string } };
  return { url: `https://x.com/i/web/status/${json.data.id}` };
}
