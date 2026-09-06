/**
 * Legacy redirect for the old `week-YYYY-MM-DD` issue URLs.
 * Ported from `public.issue_detail` (`app/routes/public.py:247-250`), including
 * its permanent 301 to the archive.
 *
 * A catch-all segment reproduces Flask's `<path:issue_id>` converter, which
 * also matched slashes.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/archive", request.url), 301);
}
