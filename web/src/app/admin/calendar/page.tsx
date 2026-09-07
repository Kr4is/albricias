/**
 * Google Calendar admin screen — Phase F of the
 * google-calendar-alexandria-sources plan. Connect/disconnect (mirrors the
 * Spotify status-card pattern from `/admin/editions`) plus a per-calendar
 * mode table, the real privacy control this feature is built around: a
 * calendar defaults to "off" the moment it's first seen, and only "stats" /
 * "articles" / "both" ever have their events read.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { getServiceToken } from "@/lib/service-token";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Google Calendar - Admin" };

const MODE_LABELS: Record<string, string> = {
  off: "Off",
  stats: "Stats only",
  articles: "Articles",
  both: "Both",
};

const MODE_OPTIONS = ["off", "stats", "articles", "both"] as const;

export default async function CalendarAdminPage({
  searchParams,
}: PageProps<"/admin/calendar">) {
  const query = await searchParams;
  const messages = readFlash(query);

  const [token, calendars] = await Promise.all([
    getServiceToken("google"),
    prisma.calendarSource.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <NewspaperShell endpoint="admin.calendar">
      <div className="pb-16 fade-in">
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">Google Calendar</span>
        </div>

        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500 mb-1">
            Editorial Office
          </p>
          <h2 className="font-masthead text-5xl text-ink">Google Calendar</h2>
        </div>

        <FlashBanner messages={messages} />

        {/* Connection status */}
        <div className="mb-8 flex items-center justify-between gap-4 flex-wrap border border-stone-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-sans text-stone-600">
            <span className="material-icons text-sm text-green-600">
              {token ? "check_circle" : "radio_button_unchecked"}
            </span>
            Google Calendar: <strong>{token ? "Connected" : "Not connected"}</strong>
          </div>
          <div className="flex gap-2">
            {token ? (
              <>
                <form method="POST" action="/admin/calendar/sync">
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                  >
                    Sync Calendars
                  </button>
                </form>
                <form method="POST" action="/admin/calendar/disconnect">
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                  >
                    Disconnect
                  </button>
                </form>
              </>
            ) : (
              <a
                href="/admin/calendar/connect"
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Connect Google Calendar
              </a>
            )}
          </div>
        </div>

        <p className="mb-8 text-xs font-serif text-stone-500 max-w-2xl">
          Every calendar defaults to <strong>Off</strong> and is completely
          ignored. Set a calendar to <strong>Stats only</strong> to feed its
          event count/hours/busiest-day numbers into an automatic ranking
          article (event titles and descriptions are never read for a
          Stats-only calendar). Set it to <strong>Articles</strong> to browse
          its events, one at a time, for manual assisted article/podcast
          generation. <strong>Both</strong> does both.
        </p>

        {/* Per-calendar mode table */}
        {calendars.length === 0 ? (
          <div className="border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-xs font-sans text-stone-500">
            {token
              ? 'No calendars found yet — click "Sync Calendars" above.'
              : "Connect your Google account to see your calendars."}
          </div>
        ) : (
          <div className="border border-stone-200 bg-white overflow-x-auto">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="border-b-2 border-ink text-left text-[10px] uppercase tracking-widest text-stone-500">
                  <th className="px-4 py-3">Calendar</th>
                  <th className="px-4 py-3">Mode</th>
                </tr>
              </thead>
              <tbody>
                {calendars.map((calendar) => (
                  <tr key={calendar.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-3">
                      {calendar.name}
                      {calendar.mode === "off" && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-stone-400">
                          (ignored)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <form
                        method="POST"
                        action="/admin/calendar/mode"
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="calendar_id" value={calendar.id} />
                        <select
                          name="mode"
                          defaultValue={calendar.mode}
                          className="bg-transparent border border-stone-300 focus:border-ink px-2 py-1.5 text-xs font-sans"
                        >
                          {MODE_OPTIONS.map((mode) => (
                            <option key={mode} value={mode}>
                              {MODE_LABELS[mode]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                        >
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </NewspaperShell>
  );
}
