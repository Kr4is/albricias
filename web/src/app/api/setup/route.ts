/**
 * POST half of Step 0 of the onboarding wizard (`src/app/setup/page.tsx`):
 * validate the submitted password, store it (hashed + encrypted) as the DB
 * admin credential, generate + store a random session-signing secret, log
 * the admin in immediately, and redirect to `/setup?step=1` (Branding — the
 * first skippable wizard step, see `src/app/setup/step/route.ts`).
 *
 * Re-checks `hasAdminPassword()` before writing anything, so a second
 * concurrent submit (or a direct POST after setup already completed some
 * other way) can't silently overwrite an existing configured instance —
 * it bounces to `/login` instead, mirroring the page's own already-configured
 * redirect.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE,
  createSessionToken,
} from "@/lib/session";
import { hasAdminPassword, setAdminPassword } from "@/lib/config/admin-auth";
import { setSetting } from "@/lib/config/settings";
import { setOnboardingStep } from "@/app/setup/onboarding";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  if (await hasAdminPassword()) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const back = new URL("/setup", request.url);

  if (password.length < MIN_PASSWORD_LENGTH) {
    back.searchParams.set("error", "short");
    return NextResponse.redirect(back, 303);
  }
  if (password !== confirm) {
    back.searchParams.set("error", "mismatch");
    return NextResponse.redirect(back, 303);
  }

  await setAdminPassword(password);
  const sessionSecret = randomBytes(32).toString("base64url");
  await setSetting("auth.sessionSecret", sessionSecret, { encrypted: true });
  await setOnboardingStep(1);

  const response = NextResponse.redirect(new URL("/setup?step=1", request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(), {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
