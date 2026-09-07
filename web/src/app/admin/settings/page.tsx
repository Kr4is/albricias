/**
 * `/admin/settings` — one form per integration category, each posting to its
 * own route handler (`./<category>/route.ts`) that calls `saveFields()`
 * (`./save-fields.ts`) for its fields. Per
 * `.omc/plans/settings-single-path-onboarding.md`, this is the *only* place
 * every credential is configured — there is no `.env` fallback for any of
 * these, with zero server restart needed to pick up a saved value.
 *
 * Category/field metadata (labels, placeholders, defaults, which fields are
 * secrets) lives in `./field-specs.ts`'s `SETTINGS_CATEGORIES`, and the field
 * renderers live in `./fields.tsx` — both shared with the `/setup`
 * onboarding wizard's steps so the two surfaces render/save the exact same
 * fields rather than duplicating the list or the markup.
 *
 * Visual style matches `/admin/account`: breadcrumb, double-ruled header, a
 * grid of white bordered cards, one `<form>` per card.
 *
 * Every field shows its current effective value's *source* — "using saved
 * setting" (a DB row exists) or "not configured" (only a hardcoded default
 * if any). Secret fields (API keys, client secrets, the SMTP password) never
 * round-trip a decrypted value into the page's HTML: their inputs render
 * blank with a "leave blank to keep the current value" placeholder, and the
 * route handlers below only overwrite a field when the submitted value is
 * non-empty — an untouched secret field is a no-op, not an accidental clear.
 * The same "blank = no change" rule applies to every field, not just
 * secrets, so re-submitting a partially-filled form never wipes out fields
 * the admin left alone.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { readFlash } from "@/lib/flash";
import { settingDisplay } from "./setting-display";
import { SETTINGS_CATEGORIES } from "./field-specs";
import { CategoryFormFields, resolveFieldValues } from "./fields";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings - Admin" };

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-stone-200 bg-white p-6">
      <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-2">
        {title}
      </h3>
      {description && <p className="text-xs font-serif text-stone-500 mb-4">{description}</p>}
      <form method="POST" action={action} className="space-y-3">
        {children}
        <button
          type="submit"
          className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors mt-2"
        >
          Save
        </button>
      </form>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: PageProps<"/admin/settings">) {
  const query = await searchParams;
  const messages = readFlash(query);

  const allFields = SETTINGS_CATEGORIES.flatMap((category) => category.fields);
  const values = await resolveFieldValues(allFields, settingDisplay);

  return (
    <NewspaperShell endpoint="admin.settings">
      <div className="pb-16 fade-in">
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">Settings</span>
        </div>

        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500 mb-1">
            Editorial Office
          </p>
          <h2 className="font-masthead text-5xl text-ink">Settings</h2>
          <p className="text-xs font-serif text-stone-500 mt-2 max-w-2xl">
            Every credential is configured here — there is no `.env` fallback.
            Saved values take effect immediately, no restart needed.
          </p>
        </div>

        <FlashBanner messages={messages} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {SETTINGS_CATEGORIES.map((category) => (
            <Card
              key={category.id}
              title={category.title}
              description={category.description}
              action={`/admin/settings/${category.id}`}
            >
              <CategoryFormFields fields={category.fields} values={values} />
            </Card>
          ))}
        </div>
      </div>
    </NewspaperShell>
  );
}
