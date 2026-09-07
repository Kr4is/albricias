/**
 * Onboarding-wizard progress, stored as ordinary `Setting` rows (never
 * encrypted — a step number and a boolean flag, nothing secret). Shared by
 * `src/app/setup/page.tsx`, `src/app/setup/step/route.ts`,
 * `src/app/api/setup/route.ts`, and `/admin/editions`' "Continue setup"
 * banner.
 *
 * `onboarding.step` tracks the *furthest* wizard step reached (1-indexed
 * into `SETTINGS_CATEGORIES`, i.e. Branding = 1) — read by the "Continue
 * setup" banner to link back to the right place, and written every time the
 * admin advances (via "Save & Continue" or "Skip"). It is not itself the
 * gate that decides whether `/setup` shows a wizard step; that's `?step=`
 * in the URL (see `page.tsx`'s doc comment for why).
 *
 * `onboarding.completed` is the terminal marker: once set, `/setup` always
 * redirects to `/login`, matching a fully-configured instance's original
 * (pre-wizard) behavior.
 */

import { getSetting, setSetting } from "@/lib/config/settings";

const STEP_KEY = "onboarding.step";
const COMPLETED_KEY = "onboarding.completed";

export async function isOnboardingCompleted(): Promise<boolean> {
  return (await getSetting(COMPLETED_KEY)) === "true";
}

export async function markOnboardingCompleted(): Promise<void> {
  await setSetting(COMPLETED_KEY, "true");
}

/** The furthest step reached so far, or `undefined` if onboarding never advanced past Step 0. */
export async function getOnboardingStep(): Promise<number | undefined> {
  const raw = await getSetting(STEP_KEY);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function setOnboardingStep(step: number): Promise<void> {
  await setSetting(STEP_KEY, String(step));
}
