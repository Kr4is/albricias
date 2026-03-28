"""Spotify Web API integration for Albricias.

Implements the OAuth 2.0 Authorization Code Flow and fetches monthly
listening data: top tracks, top artists, and recently played tracks.

Required Spotify app scopes:
    user-top-read  user-read-recently-played

Environment variables:
    SPOTIFY_CLIENT_ID
    SPOTIFY_CLIENT_SECRET
    SPOTIFY_REDIRECT_URI   (e.g. http://localhost:5000/admin/spotify/callback)
"""

import os
import base64
import datetime
import urllib.parse
from typing import Any

try:
    import httpx
except ImportError:
    raise ImportError("httpx is required: uv add httpx")

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_URL = "https://api.spotify.com/v1"

SCOPES = "user-top-read user-read-recently-played"


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------


def _client_id() -> str:
    return os.environ["SPOTIFY_CLIENT_ID"]


def _client_secret() -> str:
    return os.environ["SPOTIFY_CLIENT_SECRET"]


def _redirect_uri() -> str:
    return os.getenv(
        "SPOTIFY_REDIRECT_URI", "http://localhost:5000/admin/spotify/callback"
    )


def _basic_auth_header() -> str:
    raw = f"{_client_id()}:{_client_secret()}"
    return "Basic " + base64.b64encode(raw.encode()).decode()


def get_auth_url(state: str = "") -> str:
    """Build the Spotify /authorize redirect URL.

    Redirect the admin user's browser to this URL to start the OAuth flow.
    """
    params = {
        "client_id": _client_id(),
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "scope": SCOPES,
        "show_dialog": "false",
    }
    if state:
        params["state"] = state
    return f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"


def exchange_code(code: str) -> dict[str, Any]:
    """Exchange an authorization code for access + refresh tokens.

    Returns the full token response dict from Spotify, including:
        access_token, refresh_token, expires_in, scope, token_type
    """
    resp = httpx.post(
        SPOTIFY_TOKEN_URL,
        headers={
            "Authorization": _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _redirect_uri(),
        },
    )
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    """Obtain a new access token using a stored refresh token.

    Returns the fresh token response dict (same shape as exchange_code but
    may omit refresh_token if Spotify did not rotate it).
    """
    resp = httpx.post(
        SPOTIFY_TOKEN_URL,
        headers={
            "Authorization": _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Data fetch
# ---------------------------------------------------------------------------


def _api_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def _parse_timestamp(ts: str | None) -> datetime.datetime | None:
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def fetch_monthly_listening(access_token: str) -> list[dict[str, Any]]:
    """Fetch Spotify listening data and return normalised activity dicts.

    Calls three endpoints:
    - /me/top/tracks   (short_term ≈ last 4 weeks, limit 20)
    - /me/top/artists  (short_term ≈ last 4 weeks, limit 10)
    - /me/player/recently-played  (last 50 tracks)

    Returns items with keys: event_type, repo (None), title, url, timestamp, raw
    """
    activities: list[dict] = []
    headers = _api_headers(access_token)

    with httpx.Client(timeout=20.0) as client:
        # ------------------------------------------------------------------
        # Top tracks (last ~4 weeks)
        # ------------------------------------------------------------------
        try:
            resp = client.get(
                f"{SPOTIFY_API_URL}/me/top/tracks",
                headers=headers,
                params={"time_range": "short_term", "limit": 20},
            )
            resp.raise_for_status()
            for i, track in enumerate(resp.json().get("items", []), start=1):
                artist_names = ", ".join(
                    a["name"] for a in track.get("artists", [])
                )
                title = f"#{i} {track['name']} — {artist_names}"
                external_url = (
                    track.get("external_urls", {}).get("spotify") or ""
                )
                activities.append(
                    {
                        "event_type": "spotify_track",
                        "repo": None,
                        "title": title[:300],
                        "url": external_url,
                        "timestamp": None,
                        "raw": track,
                    }
                )
        except Exception as exc:
            print(f"[spotify] Top tracks fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Top artists (last ~4 weeks)
        # ------------------------------------------------------------------
        try:
            resp = client.get(
                f"{SPOTIFY_API_URL}/me/top/artists",
                headers=headers,
                params={"time_range": "short_term", "limit": 10},
            )
            resp.raise_for_status()
            for i, artist in enumerate(resp.json().get("items", []), start=1):
                genres = ", ".join(artist.get("genres", [])[:3])
                title = f"#{i} {artist['name']}"
                if genres:
                    title += f" ({genres})"
                external_url = (
                    artist.get("external_urls", {}).get("spotify") or ""
                )
                activities.append(
                    {
                        "event_type": "spotify_artist",
                        "repo": None,
                        "title": title[:300],
                        "url": external_url,
                        "timestamp": None,
                        "raw": artist,
                    }
                )
        except Exception as exc:
            print(f"[spotify] Top artists fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Recently played (up to 50 tracks for genre/vibe context)
        # ------------------------------------------------------------------
        try:
            resp = client.get(
                f"{SPOTIFY_API_URL}/me/player/recently-played",
                headers=headers,
                params={"limit": 50},
            )
            resp.raise_for_status()
            for item in resp.json().get("items", []):
                track = item.get("track", {})
                played_at = _parse_timestamp(item.get("played_at"))
                artist_names = ", ".join(
                    a["name"] for a in track.get("artists", [])
                )
                title = f"{track.get('name', 'Unknown')} — {artist_names}"
                external_url = (
                    track.get("external_urls", {}).get("spotify") or ""
                )
                activities.append(
                    {
                        "event_type": "spotify_played",
                        "repo": None,
                        "title": title[:300],
                        "url": external_url,
                        "timestamp": played_at,
                        "raw": item,
                    }
                )
        except Exception as exc:
            print(f"[spotify] Recently played fetch failed: {exc}")

    return activities
