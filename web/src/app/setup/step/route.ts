/**
 * POST target for every onboarding-wizard step (`../page.tsx`), Steps 1..N
 * (Step 0 — the admin password — posts to `/api/setup` instead, unchanged).
 *
 * `intent` (the name of whichever submit button was clicked):
 * - `"save"` — calls `saveFields()` with that step's `SettingFieldSpec[]`
 *   (`@/app/admin/settings/field-specs`), the exact same field list and save
 *   helper `/admin/settings/<category>/route.ts` uses, then advances.
 * - `"skip"` — advances without saving anything.
 * - `"finish"` — marks onboarding complete and redirects to
 *   `/admin/editions` immediately, without saving the current step's fields
 *   (mirrors "skip" for the current step, plus every remaining one). This is
 *   the escape hatch available from any step per the plan; if the admin
 *   wants the fields they'd typed saved too, they should hit "Save &
 *   Continue"/"Save & Finish" on the last step instead.
 *
 * Advancing past the last category also finishes onboarding (there's no
 * step N+1) — same as clicking "Finish setup" explicitly.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasAdminPassword } from "@/lib/config/admin-auth";
import { ONBOARDING_CATEGORIES } from "@/app/admin/settings/field-specs";
import { saveFields } from "@/app/admin/settings/save-fields";
import { markOnboardingCompleted, setOnboardingStep } from "../onboarding";

function clampStep(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const value = Number.isFinite(parsed) ? parsed : 1;
  return Math.min(Math.max(value, 1), ONBOARDING_CATEGORIES.length);
}

export async function POST(request: NextRequest) {
  if (!(await hasAdminPassword())) {
    return NextResponse.redirect(new URL("/setup", request.url), 303);
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const stepIndex = clampStep(form.get("step") as string | null);

  if (intent === "finish") {
    await markOnboardingCompleted();
    return NextResponse.redirect(new URL("/admin/editions", request.url), 303);
  }

  if (intent === "save") {
    const category = ONBOARDING_CATEGORIES[stepIndex - 1];
    await saveFields(form, category.fields);
  }

  const next = stepIndex + 1;
  if (next > ONBOARDING_CATEGORIES.length) {
    await markOnboardingCompleted();
    return NextResponse.redirect(new URL("/admin/editions", request.url), 303);
  }

  await setOnboardingStep(next);
  const url = new URL("/setup", request.url);
  url.searchParams.set("step", String(next));
  return NextResponse.redirect(url, 303);
}
