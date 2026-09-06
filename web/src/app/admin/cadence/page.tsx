/**
 * Cadence setting — new in the rewrite (no Flask equivalent). Lets the admin
 * view/change the global `Setting` row that decides whether "Generate
 * edition" computes a weekly or monthly period (see `@/lib/cadence`).
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { getCadence } from "@/lib/cadence";
import { CADENCE_MONTHLY, CADENCE_WEEKLY } from "@/lib/edition-helpers";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cadence Setting - Admin" };

export default async function CadencePage({
  searchParams,
}: PageProps<"/admin/cadence">) {
  const query = await searchParams;
  const messages = readFlash(query);
  const cadence = await getCadence();

  return (
    <NewspaperShell endpoint="admin.cadence">
      <div className="max-w-lg mx-auto my-10 fade-in">
        <div className="border-2 border-ink p-8 bg-paper shadow-xl">
          <div className="text-center mb-8 border-b-4 border-double border-ink pb-5">
            <h2 className="font-masthead text-4xl mb-1">Generation Cadence</h2>
            <p className="text-[10px] font-sans uppercase tracking-widest text-stone-500">
              Controls the period new editions are generated for
            </p>
          </div>

          <FlashBanner messages={messages} />

          <form method="POST" action="/admin/cadence/update" className="space-y-6 font-serif">
            <div className="space-y-3">
              <label className="flex items-center gap-3 border-2 border-stone-200 p-4 has-[:checked]:border-ink cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="cadence"
                  value={CADENCE_MONTHLY}
                  defaultChecked={cadence === CADENCE_MONTHLY}
                  className="accent-ink"
                />
                <div>
                  <p className="text-sm font-sans font-bold">Monthly</p>
                  <p className="text-[11px] font-sans text-stone-500">
                    One edition per calendar month — the original behaviour.
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-3 border-2 border-stone-200 p-4 has-[:checked]:border-ink cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="cadence"
                  value={CADENCE_WEEKLY}
                  defaultChecked={cadence === CADENCE_WEEKLY}
                  className="accent-ink"
                />
                <div>
                  <p className="text-sm font-sans font-bold">Weekly</p>
                  <p className="text-[11px] font-sans text-stone-500">
                    One edition per ISO week (Monday–Sunday).
                  </p>
                </div>
              </label>
            </div>

            <button
              type="submit"
              className="w-full bg-ink text-paper py-3 font-sans font-bold uppercase tracking-widest hover:bg-ink-light transition-colors"
            >
              Save Cadence
            </button>
          </form>
        </div>
      </div>
    </NewspaperShell>
  );
}
