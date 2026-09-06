/**
 * Minimal single-admin credential session, replacing Flask's cookie session
 * plus `login_required` (`app/auth.py:8-17`).
 *
 * There is exactly one user (the admin), so the session carries no identity —
 * just a signed "logged in until <exp>" claim in an HttpOnly cookie. The
 * signature is an HMAC-SHA256 over the payload, so the cookie cannot be forged
 * without the secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "albricias_session";

/** Session lifetime, in seconds (7 days). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

interface SessionPayload {
  /** Payload version, so the format can change without accepting old cookies. */
  v: 1;
  /** Expiry, as a Unix timestamp in seconds. */
  exp: number;
}

/**
 * Key used to sign session cookies.
 *
 * Prefers an explicit `SESSION_SECRET` (the equivalent of Flask's `SECRET_KEY`).
 * Falls back to `ADMIN_PASSWORD`, which conveniently invalidates every existing
 * session whenever the password changes. Finally falls back to a fixed dev
 * value, mirroring Flask's own `SECRET_KEY` default of `"dev-key"`
 * (`app/config.py`) — so a fresh checkout with no `.env` still logs in, just
 * like the original app. Set `SESSION_SECRET` or `ADMIN_PASSWORD` in
 * production; the dev fallback is not safe to rely on there.
 */
function signingSecret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-key";
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

/** Constant-time comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Check a submitted password against `ADMIN_PASSWORD`.
 * Mirrors the Flask default of "admin" when the env var is unset.
 */
export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "admin";
  return safeEqual(password, expected);
}

/** Build a signed session token valid for `SESSION_MAX_AGE` seconds. */
export function createSessionToken(): string {
  const payload: SessionPayload = {
    v: 1,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Return true when `token` carries a valid, unexpired signature.
 * This is the equivalent of Flask's `session.get("logged_in")`.
 */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expected: string;
  try {
    expected = sign(encoded);
  } catch {
    return false;
  }
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionPayload;
    return payload.v === 1 && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** Cookie options shared by the set/clear helpers. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;
