/**
 * Route guard for `/admin/*`, the equivalent of Flask's `login_required`
 * decorator (`app/auth.py:8-17`): unauthenticated browser requests are
 * redirected to the login page with a `next` parameter — or, if the admin
 * password has never been configured at all (no DB hash), to `/setup`
 * instead (see `.omc/plans/settings-single-path-onboarding.md`). `/login`
 * and `/api/login` apply the same `hasAdminPassword()` gate themselves,
 * since they fall outside this proxy's `/admin/:path*` matcher.
 *
 * Note: in Next.js 16 the `middleware.ts` convention was renamed to `proxy.ts`
 * (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * Proxy defaults to the Node.js runtime (not Edge), which is what already let
 * `node:crypto` work here pre-settings — and per that same doc, self-hosted
 * Node.js/Docker deployments (this app's only deployment target) run proxy in
 * the same Node.js process as the rest of the app, so the module-level
 * `globalThis`-cached PrismaClient (`src/lib/prisma.ts`) and settings-key
 * cache (`src/lib/config/crypto.ts`) are safely reused here too — a live
 * Prisma query (via `hasAdminPassword()`) works fine, no lighter-weight
 * check was needed. The doc's "don't rely on shared modules/globals" caveat
 * targets Edge/CDN deployments this app doesn't use.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { hasAdminPassword } from "@/lib/config/admin-auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

  if (!(await hasAdminPassword())) {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
