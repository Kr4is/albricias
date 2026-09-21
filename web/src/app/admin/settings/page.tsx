/**
 * `/admin/settings` — the real, linkable, refreshable page. Reached from the
 * dashboard as a modal instead (`@modal/(.)settings`, an intercepting
 * route) on a normal client-side click; this page is what a direct visit,
 * a refresh while the modal is open, or a bookmarked link actually hits —
 * that's the whole point of using interception rather than a client-only
 * dialog. Both render the same `SettingsPanel`.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import { readFlash } from "@/lib/flash";
import SettingsPanel from "./SettingsPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings - Admin" };

export default async function SettingsPage({
  searchParams,
}: PageProps<"/admin/settings">) {
  const query = await searchParams;
  const messages = readFlash(query);

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
        </div>

        <SettingsPanel messages={messages} />
      </div>
    </NewspaperShell>
  );
}
