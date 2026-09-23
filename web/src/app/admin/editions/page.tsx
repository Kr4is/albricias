/**
 * Editions dashboard — ported from `admin.editions`
 * (`app/routes/admin.py:43-56`) and `app/templates/admin/editions.html`.
 *
 * The "Generate with AI" modal and its period picker are inline here (as in
 * the original), posting to `/admin/editions/generate`. Everything that
 * isn't Drafts/Published — connections, AI config, newspaper config — lives
 * in `/admin/settings` now (see `SettingsPanel.tsx`), reached via the single
 * "Settings" header link; this page's job is only ever the edition list.
 */

import type { Metadata } from "next";
import Link from "next/link";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import PeriodPickerFields from "@/components/admin/PeriodPickerFields";
import Disclosure from "@/components/admin/Disclosure";
import DayProcessingWatcher from "@/components/admin/DayProcessingWatcher";
import { prisma } from "@/lib/prisma";
import { getCadence, dayBounds } from "@/lib/cadence";
import { EDITION_STATUS_DRAFT, EDITION_STATUS_PUBLISHED, periodLabelShort } from "@/lib/edition-helpers";
import { readFlash } from "@/lib/flash";
import { getOnboardingStep, isOnboardingCompleted } from "@/app/setup/onboarding";
import {
  canProcessDay,
  DAY_STRIP_STYLES,
  dayStatusLabel,
  getEditionDayStatuses,
  type DayInfo,
} from "@/lib/generation/day-status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Editions Dashboard - Admin" };

// DAY_STRIP_STYLES's dark statuses need light text on top; skipped/pending
// carry their own text color already.
const DAY_BADGE_LIGHT_TEXT: Record<string, boolean> = {
  processed: true,
  processing: true,
  failed: true,
  today: true,
};

/**
 * One edition's full-period day grid — every day from the period's start
 * through its end, including days still to come, each a clickable entry into
 * the day view plus (for a day already over) a one-click reprocess button
 * mirroring the day page's own "Process this day now" action, so fixing a
 * `skipped` day never requires leaving the dashboard.
 */
function DayGrid({ editionId, dayInfos }: { editionId: number; dayInfos: DayInfo[] }) {
  if (dayInfos.length === 0) return null;
  const today = dayBounds(new Date()).periodStart;

  return (
    <div className="mt-4 pt-3 border-t border-stone-100">
      <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-400 mb-3">
        Days ({dayInfos.length})
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {dayInfos.map((d) => {
          const weekday = d.date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
          // A day already running has nothing useful to offer a second click —
          // the route's claim would reject it anyway. Unless it's stale: that
          // run is abandoned, and `claimDayProcessingRun` will reclaim it.
          const reprocessable =
            canProcessDay(d.date, today) && (d.status !== "processing" || !!d.stale);
          return (
            <div
              key={d.dateStr}
              title={d.error ? `Last run failed: ${d.error}` : undefined}
              className={`border border-stone-300 hover:border-ink transition-colors flex flex-col ${DAY_STRIP_STYLES[d.status]} ${DAY_BADGE_LIGHT_TEXT[d.status] ? "text-white" : ""}`}
            >
              <a href={`/admin/editions/${editionId}/day/${d.dateStr}`} className="px-3 py-2.5">
                <p className="text-[10px] font-sans font-bold uppercase tracking-widest opacity-75">
                  {weekday}
                </p>
                <p className="text-sm font-sans font-bold">{d.dateStr}</p>
                <p className="text-[10px] font-sans uppercase tracking-widest mt-1 opacity-90">
                  {dayStatusLabel(d)}
                  {d.stale && " (stuck?)"}
                </p>
              </a>
              {reprocessable && (
                <form
                  method="POST"
                  action={`/admin/editions/${editionId}/day/${d.dateStr}/process`}
                  data-loading-submit
                  className="border-t border-black/10 mt-auto"
                >
                  <button
                    type="submit"
                    data-loading-text="Processing…"
                    className="w-full px-2 py-1.5 text-[10px] font-sans font-bold uppercase tracking-widest hover:bg-black/5 transition-colors flex items-center justify-center gap-1"
                  >
                    <span className="material-icons text-xs">refresh</span>
                    {d.status === "processing"
                      ? "Retry (stuck?)"
                      : d.status === "processed"
                        ? "Re-process"
                        : "Process"}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const editionSelect = {
  id: true,
  cadence: true,
  periodStart: true,
  periodEnd: true,
  lastProcessedDay: true,
  title: true,
  status: true,
  vol: true,
  publishedAt: true,
  generationStatus: true,
  _count: { select: { articles: true, serviceActivities: true } },
} as const;

export default async function EditionsDashboardPage({
  searchParams,
}: PageProps<"/admin/editions">) {
  const query = await searchParams;
  const messages = readFlash(query);

  const [drafts, published, cadence, onboardingCompleted, onboardingStep] = await Promise.all([
    prisma.edition.findMany({
      where: { status: EDITION_STATUS_DRAFT },
      orderBy: { periodStart: "desc" },
      select: editionSelect,
    }),
    prisma.edition.findMany({
      where: { status: EDITION_STATUS_PUBLISHED },
      orderBy: { periodStart: "desc" },
      select: editionSelect,
    }),
    getCadence(),
    isOnboardingCompleted(),
    getOnboardingStep(),
  ]);

  const now = new Date();
  const isCurrentPeriod = (e: { periodStart: Date; periodEnd: Date }) =>
    now.getTime() >= e.periodStart.getTime() && now.getTime() < e.periodEnd.getTime();

  const dayInfoByEdition = new Map(
    await Promise.all(
      [...drafts, ...published].map(async (e) => [e.id, await getEditionDayStatuses(e)] as const),
    ),
  );

  // Every day currently mid-run, across every edition on the page — one
  // watcher for the lot, not one per edition.
  const processingDays = [...dayInfoByEdition].flatMap(([id, infos]) =>
    infos.filter((d) => d.status === "processing").map((d) => ({ editionId: id, dateStr: d.dateStr })),
  );

  return (
    <NewspaperShell endpoint="admin.editions">
      <DayProcessingWatcher days={processingDays} />
      <div className="pb-12 fade-in">
        {/* Page Header */}
        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500 mb-1">
                Editorial Office
              </p>
              <h2 className="font-masthead text-5xl text-ink">Editions Dashboard</h2>
            </div>
            <div className="flex items-center gap-3 no-print flex-wrap">
              <Link
                href="/admin/settings"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-stone-300 text-xs font-bold uppercase tracking-widest text-stone-500 hover:border-ink hover:text-ink transition-colors"
              >
                <span className="material-icons text-sm">settings</span> Settings
              </Link>
              <button
                type="button"
                data-open-generate-modal
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-paper text-xs font-bold uppercase tracking-widest hover:bg-ink-light transition-colors"
              >
                <span className="material-icons text-sm">auto_awesome</span> Generate
                with AI
              </button>
            </div>
          </div>
        </div>

        <FlashBanner messages={messages} />

        {/* Continue setup banner — onboarding wizard was exited before "Finish setup" */}
        {!onboardingCompleted && (
          <div className="mb-10 flex items-center justify-between gap-4 flex-wrap border-2 border-ink bg-amber-50 px-5 py-3">
            <div className="flex items-center gap-2 text-xs font-sans text-stone-700">
              <span className="material-icons text-sm text-amber-700">info</span>
              First-run setup wasn&apos;t finished — some categories may still be unconfigured.
            </div>
            <a
              href={`/setup?step=${onboardingStep ?? 1}`}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
            >
              Continue setup
            </a>
          </div>
        )}

        {/* Drafts Section */}
        <section className="mb-14">
          <h3 className="font-headline text-2xl font-bold border-b-2 border-ink pb-2 mb-6 flex items-center gap-2">
            <span className="material-icons text-amber-600">edit_note</span>
            Drafts
            <span className="ml-2 text-sm font-sans font-normal text-stone-500">
              ({drafts.length})
            </span>
          </h3>

          {drafts.length > 0 ? (
            <div className="space-y-3">
              {drafts.map((edition) => {
                const dayInfos = dayInfoByEdition.get(edition.id) ?? [];
                const current = isCurrentPeriod(edition);
                return (
                  <Disclosure
                    key={edition.id}
                    defaultOpen={current}
                    persistKey={`edition-${edition.id}`}
                    summary={
                      <span className="flex-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 normal-case tracking-normal min-w-0">
                        <span className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-amber-600 shrink-0">
                            {current ? "Draft · Current" : "Draft"}
                          </span>
                          <span className="font-headline text-base font-bold text-ink truncate">
                            {edition.title}
                          </span>
                          <span className="font-normal text-stone-400 shrink-0">{edition.vol}</span>
                        </span>
                        <span className="font-normal text-stone-400 shrink-0">
                          {periodLabelShort(edition)} · {edition._count.articles} articles
                        </span>
                      </span>
                    }
                  >
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={`/admin/editions/${edition.id}/edit`}
                        className="flex-1 text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 hover:border-ink hover:bg-stone-50 transition-colors"
                      >
                        Edit
                      </a>
                      <a
                        href={`/admin/editions/${edition.id}/preview`}
                        className="flex-1 text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                      >
                        Preview
                      </a>
                      <form
                        method="POST"
                        action={`/admin/editions/${edition.id}/publish`}
                        className="flex-1"
                        data-loading-submit
                      >
                        <button
                          type="submit"
                          data-loading-text="Publishing…"
                          className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                        >
                          Publish
                        </button>
                      </form>
                      {edition.generationStatus !== "running" && (
                        <form
                          method="POST"
                          action={`/admin/editions/${edition.id}/delete`}
                          data-confirm="Permanently delete this edition and all its articles?"
                        >
                          <button
                            type="submit"
                            className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </form>
                      )}
                    </div>

                    <DayGrid editionId={edition.id} dayInfos={dayInfos} />
                  </Disclosure>
                );
              })}
            </div>
          ) : (
            <p className="text-stone-500 italic font-serif">
              No draft editions. Click &quot;Generate with AI&quot; above to start one.
            </p>
          )}
        </section>

        {/* Published Section */}
        <section>
          <h3 className="font-headline text-2xl font-bold border-b-2 border-ink pb-2 mb-6 flex items-center gap-2">
            <span className="material-icons text-green-700">check_circle</span>
            Published
            <span className="ml-2 text-sm font-sans font-normal text-stone-500">
              ({published.length})
            </span>
          </h3>

          {published.length > 0 ? (
            <div className="space-y-3">
              {published.map((edition) => {
                const dayInfos = dayInfoByEdition.get(edition.id) ?? [];
                const current = isCurrentPeriod(edition);
                return (
                  <Disclosure
                    key={edition.id}
                    defaultOpen={current}
                    persistKey={`edition-${edition.id}`}
                    summary={
                      <span className="flex-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 normal-case tracking-normal min-w-0">
                        <span className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-green-700 shrink-0">
                            {current ? "Published · Current" : "Published"}
                          </span>
                          <span className="font-headline text-base font-bold text-ink truncate">
                            {edition.title}
                          </span>
                          <span className="font-normal text-stone-400 shrink-0">{edition.vol}</span>
                        </span>
                        <span className="font-normal text-stone-400 shrink-0">
                          {edition.publishedAt &&
                            `Published ${edition.publishedAt.toLocaleDateString("en-US", {
                              month: "short",
                              day: "2-digit",
                              year: "numeric",
                              timeZone: "UTC",
                            })} · `}
                          {edition._count.articles} articles
                        </span>
                      </span>
                    }
                  >
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={`/edition/${edition.id}`}
                        className="flex-1 text-center px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 hover:border-ink hover:bg-stone-50 transition-colors"
                      >
                        View
                      </a>
                      <a
                        href={`/admin/editions/${edition.id}/edit`}
                        className="flex-1 text-center px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 hover:border-ink hover:bg-stone-50 transition-colors"
                      >
                        Edit
                      </a>
                      <a
                        href={`/admin/editions/${edition.id}/distribute`}
                        className="flex-1 text-center px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 hover:border-ink hover:bg-stone-50 transition-colors"
                      >
                        Distribute
                      </a>
                      <form
                        method="POST"
                        action={`/admin/editions/${edition.id}/unpublish`}
                        data-confirm="Unpublish this edition? It stops being visible to readers until you publish it again."
                        data-loading-submit
                      >
                        <button
                          type="submit"
                          data-loading-text="Unpublishing…"
                          className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                        >
                          Unpublish
                        </button>
                      </form>
                    </div>

                    <DayGrid editionId={edition.id} dayInfos={dayInfos} />
                  </Disclosure>
                );
              })}
            </div>
          ) : (
            <p className="text-stone-500 italic font-serif">No published editions yet.</p>
          )}
        </section>

      </div>

      {/* Generate Edition Modal */}
      <div
        id="generate-modal"
        className="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-paper border-2 border-ink max-w-md w-full p-8 shadow-2xl">
          <div className="text-center mb-6 border-b border-ink pb-4">
            <h3 className="font-masthead text-3xl mb-1">Generate Edition</h3>
            <p className="text-xs font-sans uppercase tracking-widest text-stone-500">
              Fetch activity &amp; write articles with AI
            </p>
          </div>

          <form
            method="POST"
            action="/admin/editions/generate"
            className="space-y-4"
            data-loading-submit
          >
            <PeriodPickerFields cadence={cadence} now={now} />
            <p className="text-[10px] font-sans text-stone-500 italic">
              Requires GitHub token/username, blog RSS URL, and/or a
              connected Spotify account, plus an AI provider — configure
              these at /admin/settings
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                data-close-generate-modal
                className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-loading-text="Generating… this can take a while"
                className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                Generate
              </button>
            </div>
          </form>
        </div>
      </div>

      <script
        // Plain vanilla-JS modal toggle, matching the Jinja original's inline
        // onclick handlers — no client component needed for this.
        dangerouslySetInnerHTML={{
          __html: `
            document.querySelectorAll('[data-open-generate-modal]').forEach(function (btn) {
              btn.addEventListener('click', function () {
                document.getElementById('generate-modal').classList.remove('hidden');
              });
            });
            document.querySelectorAll('[data-close-generate-modal]').forEach(function (btn) {
              btn.addEventListener('click', function () {
                document.getElementById('generate-modal').classList.add('hidden');
              });
            });
          `,
        }}
      />
    </NewspaperShell>
  );
}
