/**
 * POST half of `public.login` (`app/routes/public.py:24-34`): check the admin
 * password, set the session cookie, then bounce to `next` (the path `proxy.ts`
 * attaches when it turns an unauthenticated `/admin/*` request away) or to the
 * home page.
 *
 * Redirects use 303 See Other so the browser re-issues the follow-up as GET;
 * a 307 would replay this POST against the target.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE,
  createSessionToken,
  verifyAdminPassword,
} from "@/lib/session";
import { safeNextPath } from "@/lib/safe-redirect";
import { hasAdminPassword } from "@/lib/config/admin-auth";

export async function POST(request: NextRequest) {
  if (!(await hasAdminPassword())) {
    return NextResponse.redirect(new URL("/setup", request.url), 303);
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const nextPath = safeNextPath(
    typeof form.get("next") === "string" ? String(form.get("next")) : null,
  );

  if (!(await verifyAdminPassword(password))) {
    const back = new URL("/login", request.url);
    back.searchParams.set("error", "1");
    if (nextPath !== "/") back.searchParams.set("next", nextPath);
    return NextResponse.redirect(back, 303);
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(), {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
