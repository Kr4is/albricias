/**
 * First-run onboarding wizard. See `.omc/plans/settings-single-path-onboarding.md`'s
 * Step 2.
 *
 * **Step 0 (mandatory)** — shown whenever `hasAdminPassword()` is false (no
 * DB-stored admin password hash yet): the original single admin-password
 * form, unchanged. Posts to `/api/setup`, which creates the password + a
 * session secret, logs the admin in, and redirects to `/setup?step=1`.
 *
 * **Steps 1..N (skippable)** — one per entry in `SETTINGS_CATEGORIES`
 * (`@/app/admin/settings/field-specs`), in that array's order (Branding, AI,
 * GitHub, Blog, Email, Spotify, X/Twitter, Google Calendar, Alexandria).
 * Rendered with the exact same field components (`@/app/admin/settings/fields`)
 * `/admin/settings` uses, pre-filled/masked identically. Each step posts to
 * `/setup/step` (`./step/route.ts`) with `intent` = `"save"` | `"skip"` |
 * `"finish"`; that route is the only place `saveFields()` is called for
 * these steps, reusing the exact per-category `SettingFieldSpec[]` arrays
 * `/admin/settings/<category>/route.ts` also saves from.
 *
 * **Gating logic (deliberately asymmetric between the bare path and a
 * `?step=` URL — see the plan's explicit verification criteria):**
 * - `hasAdminPassword()` false → always Step 0, regardless of `?step=`.
 * - `hasAdminPassword()` true and onboarding completed
 *   (`onboarding.completed` setting) → always redirect to `/login`,
 *   regardless of `?step=`. A finished instance never re-enters the wizard.
 * - `hasAdminPassword()` true, onboarding *not* completed, and `?step=N` is
 *   present → render step `N` (clamped to a valid range), pre-filled with
 *   whatever's already saved. This is what makes a browser refresh mid-wizard
 *   safe: the URL itself (produced by `/setup/step`'s own redirects) carries
 *   the current step, so reloading it just re-renders the same step.
 * - `hasAdminPassword()` true, onboarding not completed, and `?step=` is
 *   *absent* (i.e. someone visits the bare `/setup` URL directly rather than
 *   following the wizard's own links) → redirect to `/login`, exactly like a
 *   completed instance. The wizard's own "Continue setup" banner
 *   (`/admin/editions`) links to `/setup?step=<furthest reached>`, not bare
 *   `/setup`, so a legitimate resume always carries the query param.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import { hasAdminPassword } from "@/lib/config/admin-auth";
import { settingDisplay } from "@/app/admin/settings/setting-display";
import { SETTINGS_CATEGORIES } from "@/app/admin/settings/field-specs";
import { CategoryFormFields, resolveFieldValues } from "@/app/admin/settings/fields";
import { isOnboardingCompleted } from "./onboarding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "First-Run Setup - ¡Albricias!" };

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

const ERROR_MESSAGES: Record<string, string> = {
  mismatch: "Passwords do not match.",
  short: "Password must be at least 8 characters.",
};

function clampStep(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const value = Number.isFinite(parsed) ? parsed : 1;
  return Math.min(Math.max(value, 1), SETTINGS_CATEGORIES.length);
}

function SetupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto my-12 fade-in">
      <div className="border-4 border-ink p-8 bg-paper shadow-lg relative">
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-ink"></div>
        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-ink"></div>
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-ink"></div>
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-ink"></div>
        {children}
      </div>
    </div>
  );
}

function PasswordStep({ errorMessage }: { errorMessage?: string }) {
  return (
    <SetupCard>
      <div className="text-center mb-8">
        <h2 className="font-masthead text-4xl mb-2">Welcome, Editor</h2>
        <div className="border-b border-ink border-double w-24 mx-auto mb-4"></div>
        <p className="font-sans text-xs uppercase tracking-widest text-ink-light">
          First-Run Setup — Choose Your Access Code
        </p>
      </div>

      {errorMessage && (
        <div className="mb-6 p-3 border border-red-800 bg-red-50 text-red-800 text-sm font-serif italic text-center">
          {errorMessage}
        </div>
      )}

      <form method="POST" action="/api/setup" className="space-y-6">
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-sans font-bold uppercase tracking-widest mb-2"
          >
            Access Code
          </label>
          <input
            type="password"
            name="password"
            id="password"
            required
            minLength={8}
            className="w-full bg-transparent border-2 border-ink px-4 py-3 font-serif focus:ring-0 focus:border-ink-light transition-colors"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="block text-xs font-sans font-bold uppercase tracking-widest mb-2"
          >
            Confirm Access Code
          </label>
          <input
            type="password"
            name="confirm"
            id="confirm"
            required
            minLength={8}
            className="w-full bg-transparent border-2 border-ink px-4 py-3 font-serif focus:ring-0 focus:border-ink-light transition-colors"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-ink text-paper py-3 font-sans font-bold uppercase tracking-widest hover:bg-ink-light transition-colors"
        >
          Open the Newsroom
        </button>
      </form>

      <div className="mt-8 text-center">
        <div className="border-t border-ink border-dotted pt-4">
          <p className="font-serif text-xs italic text-stone-500">
            This runs once. Set this newspaper&apos;s access code, and you&apos;re in.
          </p>
        </div>
      </div>
    </SetupCard>
  );
}

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const query = await searchParams;

  if (!(await hasAdminPassword())) {
    const errorCode = firstValue(query.error);
    const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? "Something went wrong.") : undefined;
    return (
      <NewspaperShell endpoint="public.setup">
        <PasswordStep errorMessage={errorMessage} />
      </NewspaperShell>
    );
  }

  if (await isOnboardingCompleted()) {
    redirect("/login");
  }

  const stepParam = firstValue(query.step);
  if (!stepParam) {
    // Bare `/setup` after the password already exists — never re-enter the
    // wizard from a direct/bookmarked visit. Only a `?step=` URL (produced by
    // the wizard's own redirects, or the "Continue setup" banner) continues it.
    redirect("/login");
  }

  const stepIndex = clampStep(stepParam);
  const category = SETTINGS_CATEGORIES[stepIndex - 1];
  const isLastStep = stepIndex === SETTINGS_CATEGORIES.length;
  const values = await resolveFieldValues(category.fields, settingDisplay);

  return (
    <NewspaperShell endpoint="public.setup">
      <SetupCard>
        <div className="text-center mb-8">
          <p className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2">
            Step {stepIndex} of {SETTINGS_CATEGORIES.length} — Skippable
          </p>
          <h2 className="font-masthead text-4xl mb-2">{category.title}</h2>
          <div className="border-b border-ink border-double w-24 mx-auto mb-4"></div>
          {category.description && (
            <p className="font-serif text-xs italic text-stone-500">{category.description}</p>
          )}
        </div>

        <form method="POST" action="/setup/step" className="space-y-4">
          <input type="hidden" name="step" value={stepIndex} />
          <CategoryFormFields fields={category.fields} values={values} />

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              name="intent"
              value="skip"
              className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest border-2 border-ink hover:bg-stone-100 transition-colors"
            >
              Skip
            </button>
            <button
              type="submit"
              name="intent"
              value="save"
              className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
            >
              {isLastStep ? "Save & Finish" : "Save & Continue"}
            </button>
          </div>

          <button
            type="submit"
            name="intent"
            value="finish"
            className="w-full text-center text-[10px] font-sans uppercase tracking-widest text-stone-500 hover:text-ink underline pt-2"
          >
            Finish setup now — configure the rest later at /admin/settings
          </button>
        </form>
      </SetupCard>
    </NewspaperShell>
  );
}
