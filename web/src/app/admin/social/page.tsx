/**
 * Social accounts admin screen — connect/disconnect X, Bluesky, and Mastodon
 * for auto-posting on publish. Mirrors the Spotify status-card pattern from
 * `/admin/editions` (`getServiceToken` → connected/not-connected pill +
 * connect/disconnect action), generalised to three networks with their own
 * connect flows (X: OAuth redirect; Bluesky/Mastodon: a plain credentials
 * form, per the `SocialAccount` doc comment in `prisma/schema.prisma`).
 *
 * There is no separate on/off toggle beyond connected/disconnected — see the
 * `SocialAccount` model comment: connecting sets `enabled: true`,
 * disconnecting deletes the row. A future iteration could add a toggle that
 * keeps stored credentials while pausing auto-post; not needed for this
 * phase's acceptance criteria (a disconnected network already can't be sent
 * to from the distribute screen).
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { getSocialAccount } from "@/lib/social/store";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Social Accounts - Admin" };

export default async function SocialAccountsPage({
  searchParams,
}: PageProps<"/admin/social">) {
  const query = await searchParams;
  const messages = readFlash(query);

  const [twitter, bluesky, mastodon] = await Promise.all([
    getSocialAccount("twitter"),
    getSocialAccount("bluesky"),
    getSocialAccount("mastodon"),
  ]);

  return (
    <NewspaperShell endpoint="admin.social">
      <div className="pb-16 fade-in">
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">Social Accounts</span>
        </div>

        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500 mb-1">
            Editorial Office
          </p>
          <h2 className="font-masthead text-5xl text-ink">Social Accounts</h2>
        </div>

        <FlashBanner messages={messages} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* X / Twitter */}
          <div className="border border-stone-200 bg-white p-6">
            <div className="flex items-center gap-2 mb-3 text-xs font-sans text-stone-600">
              <span className="material-icons text-sm text-green-600">
                {twitter?.enabled ? "check_circle" : "radio_button_unchecked"}
              </span>
              X (Twitter):{" "}
              <strong>{twitter?.enabled ? "Connected" : "Not connected"}</strong>
            </div>
            <p className="text-xs font-serif text-stone-500 mb-4">
              OAuth 2.0 (PKCE). Requires a client ID, secret, and redirect URI —
              set them at <a href="/admin/settings" className="underline">/admin/settings</a>.
            </p>
            {twitter?.enabled ? (
              <form method="POST" action="/admin/social/twitter/disconnect">
                <button
                  type="submit"
                  className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                >
                  Disconnect
                </button>
              </form>
            ) : (
              <a
                href="/admin/social/twitter/connect"
                className="block text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Connect X
              </a>
            )}
          </div>

          {/* Bluesky */}
          <div className="border border-stone-200 bg-white p-6">
            <div className="flex items-center gap-2 mb-3 text-xs font-sans text-stone-600">
              <span className="material-icons text-sm text-green-600">
                {bluesky?.enabled ? "check_circle" : "radio_button_unchecked"}
              </span>
              Bluesky:{" "}
              <strong>{bluesky?.enabled ? "Connected" : "Not connected"}</strong>
            </div>
            {bluesky?.enabled ? (
              <form method="POST" action="/admin/social/bluesky/disconnect">
                <button
                  type="submit"
                  className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                >
                  Disconnect
                </button>
              </form>
            ) : (
              <form method="POST" action="/admin/social/bluesky/connect" className="space-y-3">
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Identifier (handle)
                  </label>
                  <input
                    type="text"
                    name="identifier"
                    placeholder="you.bsky.social"
                    required
                    className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    App Password
                  </label>
                  <input
                    type="password"
                    name="app_password"
                    required
                    className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                  />
                </div>
                <p className="text-[10px] font-serif text-stone-500">
                  Generate one from Bluesky Settings → App Passwords.
                </p>
                <button
                  type="submit"
                  className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                >
                  Connect Bluesky
                </button>
              </form>
            )}
          </div>

          {/* Mastodon */}
          <div className="border border-stone-200 bg-white p-6">
            <div className="flex items-center gap-2 mb-3 text-xs font-sans text-stone-600">
              <span className="material-icons text-sm text-green-600">
                {mastodon?.enabled ? "check_circle" : "radio_button_unchecked"}
              </span>
              Mastodon:{" "}
              <strong>{mastodon?.enabled ? "Connected" : "Not connected"}</strong>
            </div>
            {mastodon?.enabled ? (
              <form method="POST" action="/admin/social/mastodon/disconnect">
                <button
                  type="submit"
                  className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                >
                  Disconnect
                </button>
              </form>
            ) : (
              <form method="POST" action="/admin/social/mastodon/connect" className="space-y-3">
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Instance URL
                  </label>
                  <input
                    type="url"
                    name="instance_url"
                    placeholder="https://mastodon.social"
                    required
                    className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Access Token
                  </label>
                  <input
                    type="password"
                    name="access_token"
                    required
                    className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                  />
                </div>
                <p className="text-[10px] font-serif text-stone-500">
                  Generate one from your instance&apos;s Settings → Development.
                </p>
                <button
                  type="submit"
                  className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                >
                  Connect Mastodon
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </NewspaperShell>
  );
}
