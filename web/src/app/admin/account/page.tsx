/**
 * Minimal admin account screen: change the admin password and regenerate the
 * JSON API's bearer token, both DB-stored exclusively via
 * `src/lib/config/settings.ts` — no env-var fallback of any kind. A later
 * agent may fold this into the full `/admin/settings` area.
 *
 * Changing the password deliberately does NOT rotate `auth.sessionSecret`:
 * they're independent, so changing your password doesn't silently log you
 * out of a session you're mid-use of on another device. Only this page's
 * (future) "sign out everywhere" action would rotate the session secret —
 * not built here, out of this phase's scope.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account - Admin" };

export default async function AccountPage({
  searchParams,
}: PageProps<"/admin/account">) {
  const query = await searchParams;
  const messages = readFlash(query);

  return (
    <NewspaperShell endpoint="admin.account">
      <div className="pb-16 fade-in">
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">Account</span>
        </div>

        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500 mb-1">
            Editorial Office
          </p>
          <h2 className="font-masthead text-5xl text-ink">Account</h2>
        </div>

        <FlashBanner messages={messages} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Change password */}
          <div className="border border-stone-200 bg-white p-6">
            <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-4">
              Change Admin Password
            </h3>
            <form method="POST" action="/admin/account/password" className="space-y-3">
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                />
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  name="confirm"
                  required
                  minLength={8}
                  className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                />
              </div>
              <p className="text-[10px] font-serif text-stone-500">
                Other logged-in devices stay signed in — this does not rotate the
                session-signing secret.
              </p>
              <button
                type="submit"
                className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                Update Password
              </button>
            </form>
          </div>

          {/* API token */}
          <div className="border border-stone-200 bg-white p-6">
            <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-4">
              JSON API Token
            </h3>
            <p className="text-xs font-serif text-stone-500 mb-4">
              Bearer token required by <code>POST /api/articles</code>. Regenerating
              replaces the current token (or sets one for the first time, if the
              API was previously open) — update any client using the old one.
            </p>
            <form method="POST" action="/admin/account/api-token">
              <button
                type="submit"
                className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Regenerate API Token
              </button>
            </form>
          </div>
        </div>
      </div>
    </NewspaperShell>
  );
}
