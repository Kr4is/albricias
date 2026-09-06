/**
 * Ported from `public.logout` (`app/routes/public.py:37-40`) — the header's
 * Logout link is a plain GET, so this stays a GET handler. It clears the
 * session cookie (`session.pop("logged_in")`) and returns to the home page.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/session";

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
