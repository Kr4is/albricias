/**
 * Blank draft edition form — ported from `admin.edition_new`
 * (`app/routes/admin.py:64-96`) and `app/templates/admin/edition_new.html`.
 *
 * Submits to `/admin/editions/create`, a sibling POST-only route: Next's App
 * Router cannot colocate a `page.tsx` and a `route.ts` for the same path, so
 * the GET (this page) and POST halves of the original single Flask endpoint
 * live at adjacent URLs. See the Phase 3 notes for the full list of such
 * splits.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import PeriodPickerFields from "@/components/admin/PeriodPickerFields";
import { getCadence } from "@/lib/cadence";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New Edition - Admin" };

export default async function NewEditionPage({
  searchParams,
}: PageProps<"/admin/editions/new">) {
  const query = await searchParams;
  const messages = readFlash(query);
  const cadence = await getCadence();

  return (
    <NewspaperShell endpoint="admin.edition_new">
      <div className="max-w-lg mx-auto my-10 fade-in">
        <div className="border-2 border-ink p-8 bg-paper shadow-xl">
          <div className="text-center mb-8 border-b-4 border-double border-ink pb-5">
            <h2 className="font-masthead text-4xl mb-1">New Edition</h2>
            <p className="text-[10px] font-sans uppercase tracking-widest text-stone-500">
              Create a blank draft edition
            </p>
          </div>

          <FlashBanner messages={messages} />

          <form method="POST" action="/admin/editions/create" className="space-y-6 font-serif">
            <PeriodPickerFields cadence={cadence} now={new Date()} />

            <div className="flex gap-3 pt-4 border-t border-ink">
              <a
                href="/admin/editions"
                className="flex-1 text-center px-4 py-3 text-xs font-bold font-sans uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Cancel
              </a>
              <button
                type="submit"
                className="flex-1 px-4 py-3 text-xs font-bold font-sans uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                Create Draft
              </button>
            </div>
          </form>
        </div>
      </div>
    </NewspaperShell>
  );
}
