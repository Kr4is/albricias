/**
 * Minimal single-admin credential session, replacing Flask's cookie session
 * plus `login_required` (`app/auth.py:8-17`).
 *
 * There is exactly one user (the admin), so the session carries no identity —
 * just a signed "logged in until <exp>" claim in an HttpOnly cookie. The
 * signature is an HMAC-SHA256 over the payload, so the cookie cannot be forged
 * without the secret.
 *
 * Per `.omc/plans/settings-single-path-onboarding.md`, both the signing
 * secret and the admin password check resolve exclusively through the
 * DB-backed settings store (`src/lib/config/settings.ts` /
 * `src/lib/config/admin-auth.ts`) — no env-var fallback of any kind — which
 * is why every function here that used to be synchronous is now `async`.
 * Every caller (`proxy.ts`, `src/app/api/login/route.ts`,
 * `src/components/Header.tsx`) has been updated to `await` accordingly.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSetting } from "@/lib/config/settings";
import { verifyStoredAdminPassword } from "@/lib/config/admin-auth";

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
 * Key used to sign session cookies: `auth.sessionSecret`, a DB-stored random
 * value always set by `/setup` — see `src/lib/config/settings.ts`.
 *
 * There is no env-var or hardcoded fallback here. Unlike the "graceful
 * degradation" pattern used elsewhere in this app for optional integrations,
 * auth is not optional: if this is somehow called before `/setup` has run
 * (it shouldn't be, since every gated route checks `hasAdminPassword()`
 * first), failing loudly beats silently signing sessions with a guessable
 * default.
 */
async function signingSecret(): Promise<string> {
  const dbSecret = await getSetting("auth.sessionSecret", { encrypted: true });
  if (!dbSecret) {
    throw new Error(
      "No session signing secret configured. Complete /setup before using the admin session.",
    );
  }
  return dbSecret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function sign(payload: string): Promise<string> {
  return createHmac("sha256", await signingSecret()).update(payload).digest("base64url");
}

/** Constant-time comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Check a submitted password against the DB-stored hash — see
 * `src/lib/config/admin-auth.ts`'s `verifyStoredAdminPassword`.
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  return verifyStoredAdminPassword(password);
}

/** Build a signed session token valid for `SESSION_MAX_AGE` seconds. */
export async function createSessionToken(): Promise<string> {
  const payload: SessionPayload = {
    v: 1,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${await sign(encoded)}`;
}

/**
 * Return true when `token` carries a valid, unexpired signature.
 * This is the equivalent of Flask's `session.get("logged_in")`.
 */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expected: string;
  try {
    expected = await sign(encoded);
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
