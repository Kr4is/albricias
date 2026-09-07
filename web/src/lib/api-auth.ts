/**
 * Bearer-token guard for API route handlers, ported from
 * `require_api_token` (`app/auth.py:20-36`).
 *
 * Deliberately permissive when no token is configured, so the API stays
 * open in local/dev setups without extra config — same behaviour as the
 * Flask version, and an intentional "API is open until you configure a
 * token" default (not an env fallback). The token is resolved exclusively
 * via `getSetting("auth.apiToken", ...)` — a DB-stored value (settable from
 * `/admin/account`) — with no `process.env.API_TOKEN` read at all.
 *
 * Usage in a route handler:
 *
 *   export async function GET(request: Request) {
 *     const denied = await requireApiToken(request);
 *     if (denied) return denied;
 *     ...
 *   }
 */

import { timingSafeEqual } from "node:crypto";
import { getSetting } from "@/lib/config/settings";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Returns a 401 `Response` when the request should be rejected, or `null` when
 * it may proceed.
 */
export async function requireApiToken(request: Request): Promise<Response | null> {
  const token = await getSetting("auth.apiToken", { encrypted: true });
  if (!token) return null;

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
