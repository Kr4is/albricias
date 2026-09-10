/**
 * Rankings admin action — Phase C of the agent-editions plan.
 *
 * Three independent forms, each POSTing to its own sibling route (mirroring
 * the split already used by `.../articles/generate` + `.../generate/run`):
 *
 *   1. Activity Ranking (`./activity`)  — also wired automatically into every
 *      generated edition (see `runEditionGeneration` in `@/lib/generation`);
 *      this button is a manual re-run/retry path.
 *   2. Best-Of Digest (`./best-of`)     — admin-triggered only, needs a prior
 *      published edition to draw from.
 *   3. Custom Ranking Builder (`./custom`) — admin-triggered only; picks a
 *      field from `RANKABLE_FIELDS`, a top-N count, and a scope edition.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { periodLabel } from "@/lib/edition-helpers";
import { previousPublishedEdition } from "@/lib/editions";
import { readFlash } from "@/lib/flash";
import { prisma } from "@/lib/prisma";
import { RANKABLE_FIELDS } from "@/lib/rankings";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function loadEdition(editionId: string) {
  const id = parseId(editionId);
  if (id === null) return null;
  return prisma.edition.findUnique({ where: { id } });
}

export const metadata: Metadata = { title: "Rankings - Admin" };

export default async function RankingsPage({
  params,
  searchParams,
}: PageProps<"/admin/editions/[editionId]/articles/rank">) {
  const { editionId } = await params;
  const query = await searchParams;
  const messages = readFlash(query);

  const edition = await loadEdition(editionId);
  if (!edition) notFound();

  const [githubActivityCount, priorPublished, editions] = await Promise.all([
    prisma.serviceActivity.count({ where: { editionId: edition.id, source: "github" } }),
    previousPublishedEdition(edition.periodStart),
    prisma.edition.findMany({
      orderBy: { periodStart: "desc" },
      select: { id: true, title: true },
    }),
  ]);

  return (
    <NewspaperShell endpoint="admin.article_rank">
      <div className="max-w-3xl mx-auto pb-16 fade-in">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <a href={`/admin/editions/${edition.id}/edit`} className="hover:underline">
            {edition.title}
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">Rankings</span>
        </div>

        <FlashBanner messages={messages} />

        <div className="text-center mb-8 border-b-4 border-double border-ink pb-5">
          <p className="text-[10px] font-sans uppercase tracking-widest text-stone-500 mb-1">
            {edition.title} · AI Assisted
          </p>
          <h2 className="font-masthead text-4xl">Rankings</h2>
          <p className="mt-2 text-xs font-sans italic text-stone-500">
            Turn stored numbers into a newspaper column — activity, past-content
            retrospectives, or a custom top-N countdown.
          </p>
        </div>

        <div className="space-y-8 font-serif">
          {/* 1. Activity ranking */}
          <fieldset className="border-2 border-ink p-6 bg-paper">
            <legend className="px-2 text-xs font-sans font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="material-icons text-sm">insights</span>
              Activity Ranking
            </legend>
            <p className="text-xs font-sans text-stone-500 mb-1">
              Busiest day(s), commit/PR/issue/release/star breakdown, and most-used
              languages from this edition&apos;s GitHub activity.
            </p>
            <p className="text-[11px] font-sans text-stone-400 italic mb-4">
              {githubActivityCount > 0
                ? `${githubActivityCount} GitHub event(s) recorded for this edition — also generated automatically for every new edition.`
                : "No GitHub activity recorded for this edition yet — generating now will find nothing to rank."}
            </p>
            <form
              method="POST"
              action={`/admin/editions/${edition.id}/articles/rank/activity`}
              data-loading-submit
            >
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-purple-700 text-white hover:bg-purple-800 transition-colors"
              >
                <span className="material-icons text-sm">auto_awesome</span> Generate Activity
                Ranking
              </button>
            </form>
          </fieldset>

          {/* 2. Best-of digest */}
          <fieldset className="border-2 border-ink p-6 bg-paper">
            <legend className="px-2 text-xs font-sans font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="material-icons text-sm">military_tech</span>
              Best-Of Digest
            </legend>
            <p className="text-xs font-sans text-stone-500 mb-1">
              An AI-curated &quot;best of last period&quot; retrospective — an editorial
              judgment call, not a metrics-based ranking (no real engagement data
              exists yet).
            </p>
            <p className="text-[11px] font-sans text-stone-400 italic mb-4">
              {priorPublished
                ? `Most recent published edition: "${priorPublished.title}" (${periodLabel(priorPublished)}).`
                : "No previously published edition found yet — nothing to build a digest from."}
            </p>
            <form
              method="POST"
              action={`/admin/editions/${edition.id}/articles/rank/best-of`}
              data-loading-submit
            >
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-purple-700 text-white hover:bg-purple-800 transition-colors"
              >
                <span className="material-icons text-sm">auto_awesome</span> Generate Best-Of
                Digest
              </button>
            </form>
          </fieldset>

          {/* 3. Custom ranking builder */}
          <fieldset className="border-2 border-ink p-6 bg-paper">
            <legend className="px-2 text-xs font-sans font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="material-icons text-sm">leaderboard</span>
              Custom Ranking Builder
            </legend>
            <p className="text-xs font-sans text-stone-500 mb-4">
              Pick a field, a top-N count, and which edition&apos;s data to rank —
              generates one ranking article the same way as above.
            </p>
            <form
              method="POST"
              action={`/admin/editions/${edition.id}/articles/rank/custom`}
              className="space-y-4"
              data-loading-submit
            >
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Rank By
                </label>
                <select
                  name="field"
                  defaultValue={`${RANKABLE_FIELDS[0].model}:${RANKABLE_FIELDS[0].field}`}
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans appearance-none"
                >
                  {RANKABLE_FIELDS.map((f) => (
                    <option key={`${f.model}:${f.field}`} value={`${f.model}:${f.field}`}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Top N
                  </label>
                  <input
                    type="number"
                    name="top_n"
                    min={1}
                    max={50}
                    defaultValue={5}
                    required
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Scope To Edition
                  </label>
                  <select
                    name="scope_edition_id"
                    defaultValue={edition.id}
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans appearance-none"
                  >
                    {editions.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                        {e.id === edition.id ? " (this edition)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-purple-700 text-white hover:bg-purple-800 transition-colors"
              >
                <span className="material-icons text-sm">auto_awesome</span> Generate Custom
                Ranking
              </button>
            </form>
          </fieldset>

          <div className="pt-4 border-t-4 border-double border-ink">
            <a
              href={`/admin/editions/${edition.id}/edit`}
              className="inline-block px-4 py-3 text-xs font-bold font-sans uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
            >
              Back to Edition
            </a>
          </div>
        </div>
      </div>
    </NewspaperShell>
  );
}
