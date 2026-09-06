/**
 * Spotify Web API integration.
 *
 * Ported from `app/services/spotify.py`: the OAuth 2.0 Authorization Code Flow
 * helpers plus the listening-data fetch, generalised from "this month" to an
 * optional `[periodStart, periodEnd)` range.
 *
 * Like the Python original this module is pure service logic — the
 * `/admin/spotify/{connect,callback,disconnect}` route handlers and the
 * `ServiceToken` persistence around them belong to the admin-routes phase.
 *
 * Required Spotify app scopes: `user-top-read user-read-recently-played`.
 *
 * Environment variables:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *   SPOTIFY_REDIRECT_URI  (e.g. http://localhost:3000/admin/spotify/callback)
 */

import {
  type ActivityItem,
  type Period,
  inPeriod,
  parseTimestamp,
} from "./types";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = "user-top-read user-read-recently-played";

/** Same 300-char title budget as the Python original. */
const TITLE_MAX = 300;

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function redirectUri(): string {
  return (
    process.env.SPOTIFY_REDIRECT_URI ??
    "http://localhost:3000/admin/spotify/callback"
  );
}

function basicAuthHeader(): string {
  const raw = `${requireEnv("SPOTIFY_CLIENT_ID")}:${requireEnv("SPOTIFY_CLIENT_SECRET")}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/** The token response Spotify returns from both grant types. */
export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds until `access_token` expires. */
  expires_in: number;
  /** Absent when Spotify chooses not to rotate the refresh token. */
  refresh_token?: string;
  scope?: string;
}

/**
 * Build the Spotify `/authorize` redirect URL.
 *
 * Ported from `spotify.py:get_auth_url`. Send the admin's browser here to start
 * the OAuth flow.
 */
export function getAuthUrl(state = ""): string {
  const params = new URLSearchParams({
    client_id: requireEnv("SPOTIFY_CLIENT_ID"),
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SPOTIFY_SCOPES,
    show_dialog: "false",
  });
  if (state) params.set("state", state);
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Spotify token request failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as SpotifyTokenResponse;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Ported from `spotify.py:exchange_code`.
 */
export function exchangeCode(code: string): Promise<SpotifyTokenResponse> {
  return postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
}

/**
 * Obtain a fresh access token from a stored refresh token.
 * Ported from `spotify.py:refresh_access_token`.
 *
 * The response may omit `refresh_token` when Spotify does not rotate it.
 */
export function refreshAccessToken(
  refreshToken: string,
): Promise<SpotifyTokenResponse> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------

interface SpotifyArtistRef {
  name: string;
}

interface SpotifyTrack {
  name?: string;
  artists?: SpotifyArtistRef[];
  external_urls?: { spotify?: string };
}

interface SpotifyArtist {
  name?: string;
  genres?: string[];
  external_urls?: { spotify?: string };
}

async function getJson<T>(
  url: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${url}?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `Spotify request failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export interface SpotifyFetchOptions {
  /** A currently-valid Spotify access token. */
  accessToken: string;
  /**
   * Optional edition period. Only `spotify_played` items carry a timestamp, so
   * only those are filtered; top tracks/artists are always "short_term"
   * (Spotify's trailing ~4 weeks) and have no timestamp to filter on.
   *
   * Omit it to reproduce the Python behaviour of keeping every item.
   */
  period?: Period;
}

/**
 * Fetch Spotify listening data as normalised activity items.
 *
 * Ported from `spotify.py:fetch_monthly_listening`. Calls the same three
 * endpoints, in the same order, with the same limits:
 *   - `/me/top/tracks`              (short_term, limit 20)  → `spotify_track`
 *   - `/me/top/artists`             (short_term, limit 10)  → `spotify_artist`
 *   - `/me/player/recently-played`  (limit 50)              → `spotify_played`
 *
 * Individual endpoint failures are logged and skipped, never thrown.
 */
export async function fetchSpotifyActivity({
  accessToken,
  period,
}: SpotifyFetchOptions): Promise<ActivityItem[]> {
  const activities: ActivityItem[] = [];

  // ---------------------------------------------------------------------
  // Top tracks (last ~4 weeks)
  // ---------------------------------------------------------------------
  try {
    const data = await getJson<{ items?: SpotifyTrack[] }>(
      `${SPOTIFY_API_URL}/me/top/tracks`,
      accessToken,
      { time_range: "short_term", limit: "20" },
    );
    (data.items ?? []).forEach((track, index) => {
      const artistNames = (track.artists ?? []).map((a) => a.name).join(", ");
      activities.push({
        source: "spotify",
        eventType: "spotify_track",
        repo: null,
        title: `#${index + 1} ${track.name} — ${artistNames}`.slice(0, TITLE_MAX),
        url: track.external_urls?.spotify || "",
        timestamp: null,
        raw: track,
      });
    });
  } catch (error) {
    console.error(`[spotify] Top tracks fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Top artists (last ~4 weeks)
  // ---------------------------------------------------------------------
  try {
    const data = await getJson<{ items?: SpotifyArtist[] }>(
      `${SPOTIFY_API_URL}/me/top/artists`,
      accessToken,
      { time_range: "short_term", limit: "10" },
    );
    (data.items ?? []).forEach((artist, index) => {
      const genres = (artist.genres ?? []).slice(0, 3).join(", ");
      let title = `#${index + 1} ${artist.name}`;
      if (genres) title += ` (${genres})`;
      activities.push({
        source: "spotify",
        eventType: "spotify_artist",
        repo: null,
        title: title.slice(0, TITLE_MAX),
        url: artist.external_urls?.spotify || "",
        timestamp: null,
        raw: artist,
      });
    });
  } catch (error) {
    console.error(`[spotify] Top artists fetch failed: ${describe(error)}`);
  }

  // ---------------------------------------------------------------------
  // Recently played (up to 50 tracks for genre/vibe context)
  // ---------------------------------------------------------------------
  try {
    const data = await getJson<{
      items?: { track?: SpotifyTrack; played_at?: string }[];
    }>(`${SPOTIFY_API_URL}/me/player/recently-played`, accessToken, {
      limit: "50",
    });
    for (const item of data.items ?? []) {
      const playedAt = parseTimestamp(item.played_at);
      if (period && !inPeriod(playedAt, period)) continue;
      const track = item.track ?? {};
      const artistNames = (track.artists ?? []).map((a) => a.name).join(", ");
      activities.push({
        source: "spotify",
        eventType: "spotify_played",
        repo: null,
        title: `${track.name ?? "Unknown"} — ${artistNames}`.slice(0, TITLE_MAX),
        url: track.external_urls?.spotify || "",
        timestamp: playedAt,
        raw: item,
      });
    }
  } catch (error) {
    console.error(`[spotify] Recently played fetch failed: ${describe(error)}`);
  }

  return activities;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
