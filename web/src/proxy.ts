/**
 * Route guard for `/admin/*`, the equivalent of Flask's `login_required`
 * decorator (`app/auth.py:8-17`): unauthenticated browser requests are
 * redirected to the login page with a `next` parameter.
 *
 * Note: in Next.js 16 the `middleware.ts` convention was renamed to `proxy.ts`
 * (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * Proxy runs on the Node.js runtime by default, so `node:crypto` is available.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
