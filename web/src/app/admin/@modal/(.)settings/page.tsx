/**
 * Settings, intercepted as a modal over whatever `/admin/*` page linked to
 * it (see `admin/layout.tsx`'s `@modal` slot). Only fires for a client-side
 * navigation via `next/link` — the dashboard's Settings entry point uses
 * `<Link>` for exactly this; a direct visit, refresh, or any plain `<a>`
 * still lands on the real page at `admin/settings/page.tsx`.
 *
 * One known tradeoff of mixing this with the app's plain `<form
 * method="POST">` save/test actions (no client-side fetch conversion,
 * matching every other form in this codebase): submitting one of those
 * forms is a full server redirect back to `/admin/settings`, which Next
 * treats as a fresh navigation rather than a soft transition — so saving or
 * testing a category closes the modal and lands on the real full page
 * instead of staying interception. Acceptable: the save/test itself still
 * works identically either way, and the admin lands exactly where the
 * un-intercepted flow always went.
 */

import { readFlash } from "@/lib/flash";
import Modal from "@/components/admin/Modal";
import SettingsPanel from "../../settings/SettingsPanel";

export default async function SettingsModal({
  searchParams,
}: PageProps<"/admin/settings">) {
  const query = await searchParams;
  const messages = readFlash(query);

  return (
    <Modal title="Settings">
      <SettingsPanel messages={messages} />
    </Modal>
  );
}
