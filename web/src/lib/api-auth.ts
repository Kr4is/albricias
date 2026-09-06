/**
 * Bearer-token guard for API route handlers, ported from
 * `require_api_token` (`app/auth.py:20-36`).
 *
 * Deliberately permissive when `API_TOKEN` is unset, so the API stays open in
 * local/dev setups without extra config — same behaviour as the Flask version.
 *
 * Usage in a route handler:
 *
 *   export async function GET(request: Request) {
 *     const denied = requireApiToken(request);
 *     if (denied) return denied;
 *     ...
 *   }
 */

import { timingSafeEqual } from "node:crypto";

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
export function requireApiToken(request: Request): Response | null {
  const token = process.env.API_TOKEN;
  if (!token) return null;

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
