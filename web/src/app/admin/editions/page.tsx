/**
 * Editions dashboard — ported from `admin.editions`
 * (`app/routes/admin.py:43-56`) and `app/templates/admin/editions.html`.
 *
 * The "Generate with AI" modal and its period picker are inline here (as in
 * the original), posting to `/admin/editions/generate`. The Spotify status
 * card is new — the original surfaced connect/disconnect only via bare links
 * (`admin.py:622-687`) with no dashboard entry point.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import PeriodPickerFields from "@/components/admin/PeriodPickerFields";
import { prisma } from "@/lib/prisma";
import { getCadence } from "@/lib/cadence";
import { getServiceToken } from "@/lib/service-token";
import { EDITION_STATUS_DRAFT, EDITION_STATUS_PUBLISHED, periodLabelShort } from "@/lib/edition-helpers";
import { readFlash } from "@/lib/flash";
import { getOnboardingStep, isOnboardingCompleted } from "@/app/setup/onboarding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Editions Dashboard - Admin" };

const editionSelect = {
  id: true,
  cadence: true,
  periodStart: true,
  periodEnd: true,
  title: true,
  status: true,
  vol: true,
  publishedAt: true,
  _count: { select: { articles: true, serviceActivities: true } },
} as const;

export default async function EditionsDashboardPage({
  searchParams,
}: PageProps<"/admin/editions">) {
  const query = await searchParams;
  const messages = readFlash(query);

  const [drafts, published, cadence, spotifyToken, onboardingCompleted, onboardingStep] = await Promise.all([
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
    getServiceToken("spotify"),
    isOnboardingCompleted(),
    getOnboardingStep(),
  ]);

  const now = new Date();

  return (
    <NewspaperShell endpoint="admin.editions">
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
              <a
                href="/admin/cadence"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-stone-300 text-xs font-bold uppercase tracking-widest text-stone-500 hover:border-ink hover:text-ink transition-colors"
              >
                <span className="material-icons text-sm">tune</span> Cadence:{" "}
                {cadence}
              </a>
              <a
                href="/admin/compose"
                className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-ink text-xs font-bold uppercase tracking-widest hover:bg-stone-100 transition-colors"
              >
                <span className="material-icons text-sm">edit_note</span> Editor&apos;s
                Desk
              </a>
              <a
                href="/admin/editions/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-ink text-xs font-bold uppercase tracking-widest hover:bg-stone-100 transition-colors"
              >
                <span className="material-icons text-sm">add</span> New Edition
              </a>
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

        {/* Spotify status */}
        <div className="mb-10 flex items-center justify-between gap-4 flex-wrap border border-stone-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-sans text-stone-600">
            <span className="material-icons text-sm text-green-600">
              {spotifyToken ? "check_circle" : "radio_button_unchecked"}
            </span>
            Spotify:{" "}
            <strong>{spotifyToken ? "Connected" : "Not connected"}</strong>
          </div>
          {spotifyToken ? (
            <form method="POST" action="/admin/spotify/disconnect">
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
              >
                Disconnect
              </button>
            </form>
          ) : (
            <a
              href="/admin/spotify/connect"
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
            >
              Connect Spotify
            </a>
          )}
        </div>

        {/* Social accounts entry point (Phase D) */}
        <div className="mb-10 flex items-center justify-between gap-4 flex-wrap border border-stone-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-sans text-stone-600">
            <span className="material-icons text-sm">share</span>
            Social auto-post accounts (X, Bluesky, Mastodon)
          </div>
          <a
            href="/admin/social"
            className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
          >
            Manage
          </a>
        </div>

        {/* Google Calendar entry point (Phase F) */}
        <div className="mb-10 flex items-center justify-between gap-4 flex-wrap border border-stone-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-sans text-stone-600">
            <span className="material-icons text-sm">event</span>
            Google Calendar (stats ranking + meeting-notes articles)
          </div>
          <a
            href="/admin/calendar"
            className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
          >
            Manage
          </a>
        </div>

        {/* Settings entry point (Phase H3) */}
        <div className="mb-10 flex items-center justify-between gap-4 flex-wrap border border-stone-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-sans text-stone-600">
            <span className="material-icons text-sm">settings</span>
            Branding, AI, GitHub, email, and OAuth app credentials
          </div>
          <a
            href="/admin/settings"
            className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
          >
            Manage
          </a>
        </div>

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
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {drafts.map((edition) => (
                <div
                  key={edition.id}
                  className="border-2 border-stone-300 hover:border-ink transition-colors bg-white p-6 flex flex-col"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-amber-600 mb-1">
                        Draft
                      </p>
                      <h4 className="font-headline text-xl font-bold leading-tight">
                        {edition.title}
                      </h4>
                      <p className="text-xs font-sans text-stone-500 mt-1">
                        {edition.vol}
                      </p>
                    </div>
                    <span className="text-2xl font-masthead text-stone-300">
                      {periodLabelShort(edition)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-4">
                    <span className="material-icons text-sm">article</span>
                    {edition._count.articles} articles
                    {edition._count.serviceActivities > 0 && (
                      <>
                        <span className="ml-2 material-icons text-sm">code</span>
                        {edition._count.serviceActivities} activity events
                      </>
                    )}
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2">
                    <a
                      href={`/admin/editions/${edition.id}/edit`}
                      className="flex-1 text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                    >
                      Edit
                    </a>
                    <a
                      href={`/admin/editions/${edition.id}/preview`}
                      className="flex-1 text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                    >
                      Preview
                    </a>
                    <form method="POST" action={`/admin/editions/${edition.id}/publish`} className="flex-1">
                      <button
                        type="submit"
                        className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                      >
                        Publish
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-stone-500 italic font-serif">
              No draft editions. Create one above.
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
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {published.map((edition) => (
                <div
                  key={edition.id}
                  className="border border-stone-200 hover:border-ink transition-colors bg-white p-5 flex flex-col"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-green-700 mb-0.5">
                        Published
                      </p>
                      <h4 className="font-headline text-lg font-bold">{edition.title}</h4>
                      <p className="text-[10px] font-sans text-stone-400 mt-0.5">
                        {edition.vol}
                      </p>
                    </div>
                  </div>
                  {edition.publishedAt && (
                    <p className="text-[10px] font-sans text-stone-400 mb-3">
                      Published{" "}
                      {edition.publishedAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </p>
                  )}
                  <div className="flex items-center gap-1 text-xs font-sans text-stone-500 mb-4">
                    {edition._count.articles} articles
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
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
                    <form method="POST" action={`/admin/editions/${edition.id}/unpublish`}>
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                      >
                        Unpublish
                      </button>
                    </form>
                  </div>
                </div>
              ))}
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

          <form method="POST" action="/admin/editions/generate" className="space-y-4">
            <PeriodPickerFields cadence={cadence} now={now} />
            <p className="text-[10px] font-sans text-stone-500 italic">
              Requires GitHub token/username, blog RSS URL, and/or a
              connected Spotify account, plus an OpenAI API key — configure
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
