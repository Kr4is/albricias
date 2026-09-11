/**
 * Post-publish review screen — the Phase D integration point.
 *
 * Shows AI-generated per-network post copy (editable) for all five social
 * networks, a per-network "Send" action for the three auto-postable ones
 * (X, Bluesky, Mastodon — only shown when that network is connected), plain
 * copy-to-clipboard boxes for LinkedIn/Instagram (manual-paste only, no send
 * action — their APIs aren't viable for personal-account auto-posting), and
 * a "Send Newsletter" action that calls Wave 1's `sendNewsletterForEdition()`
 * directly (see `@/lib/mail`).
 *
 * Reached by the publish route's redirect
 * (`/admin/editions/[editionId]/publish/route.ts`), but nothing on this page
 * fires automatically — every send is an explicit button click, per the
 * plan's "no silent auto-send" acceptance criterion. Visiting this page (or
 * publishing) with no social accounts connected and no `OPENAI_API_KEY` set
 * must render without crashing: copy generation falls back to a plain
 * template (see `defaultSocialCopy`) and every network shows "Not
 * connected."
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { periodLabel } from "@/lib/edition-helpers";
import { readFlash, describeError, type FlashMessage } from "@/lib/flash";
import { getSocialAccount } from "@/lib/social/store";
import { generateSocialCopy, defaultSocialCopy, editionUrl } from "@/lib/social/copy";
import { TWITTER_TEXT_LIMIT } from "@/lib/social/twitter";
import { BLUESKY_TEXT_LIMIT } from "@/lib/social/bluesky";
import { MASTODON_TEXT_LIMIT } from "@/lib/social/mastodon";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/admin/editions/[editionId]/distribute">): Promise<Metadata> {
  const { editionId } = await params;
  const id = parseId(editionId);
  const edition = id === null ? null : await prisma.edition.findUnique({ where: { id } });
  return { title: edition ? `Distribute: ${edition.title} - Admin` : "Edition Not Found - Admin" };
}

export default async function DistributePage({
  params,
  searchParams,
}: PageProps<"/admin/editions/[editionId]/distribute">) {
  const { editionId } = await params;
  const query = await searchParams;
  const id = parseId(editionId);
  const edition = id === null ? null : await prisma.edition.findUnique({ where: { id } });
  if (!edition) notFound();

  const messages: FlashMessage[] = readFlash(query);

  const [twitter, bluesky, mastodon] = await Promise.all([
    getSocialAccount("twitter"),
    getSocialAccount("bluesky"),
    getSocialAccount("mastodon"),
  ]);

  let copy;
  try {
    copy = await generateSocialCopy(edition.id);
  } catch (error) {
    copy = await defaultSocialCopy(edition);
    messages.unshift({
      type: "warning",
      text: `Could not generate AI social copy (${describeError(error)}) — showing a basic template instead.`,
    });
  }

  const link = await editionUrl(edition.id);

  return (
    <NewspaperShell endpoint="admin.edition_distribute">
      <div className="pb-16 fade-in">
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <a href={`/admin/editions/${edition.id}/edit`} className="hover:underline">
            {edition.title}
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">Distribute</span>
        </div>

        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-green-700 mb-1">
            Published
          </p>
          <h2 className="font-masthead text-5xl text-ink">{edition.title}</h2>
          <p className="text-xs font-sans text-stone-500 mt-1">{periodLabel(edition)}</p>
          <a href={link} className="text-xs font-sans text-stone-500 hover:underline">
            {link}
          </a>
        </div>

        <FlashBanner messages={messages} />

        {/* Auto-postable networks */}
        <section className="mb-14">
          <h3 className="font-headline text-xl font-bold border-b-2 border-ink pb-2 mb-6">
            Social Auto-Post
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <NetworkCard
              label="X"
              connected={Boolean(twitter?.enabled)}
              action={`/admin/editions/${edition.id}/distribute/send-x`}
              defaultValue={copy.x}
              limit={TWITTER_TEXT_LIMIT}
            />
            <NetworkCard
              label="Bluesky"
              connected={Boolean(bluesky?.enabled)}
              action={`/admin/editions/${edition.id}/distribute/send-bluesky`}
              defaultValue={copy.bluesky}
              limit={BLUESKY_TEXT_LIMIT}
            />
            <NetworkCard
              label="Mastodon"
              connected={Boolean(mastodon?.enabled)}
              action={`/admin/editions/${edition.id}/distribute/send-mastodon`}
              defaultValue={copy.mastodon}
              limit={MASTODON_TEXT_LIMIT}
            />
          </div>
        </section>

        {/* Copy-paste only networks */}
        <section className="mb-14">
          <h3 className="font-headline text-xl font-bold border-b-2 border-ink pb-2 mb-6">
            Copy &amp; Paste
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CopyBox id="linkedin-copy" label="LinkedIn" defaultValue={copy.linkedin} />
            <CopyBox id="instagram-copy" label="Instagram" defaultValue={copy.instagram} />
          </div>
        </section>

        {/* Newsletter */}
        <section>
          <h3 className="font-headline text-xl font-bold border-b-2 border-ink pb-2 mb-6">
            Email Newsletter
          </h3>
          <div className="border border-stone-200 bg-white p-6 flex items-center justify-between flex-wrap gap-4">
            <p className="text-xs font-sans text-stone-500 max-w-md">
              Sends the edition summary email to every confirmed subscriber.
              Degrades gracefully with a warning if SMTP isn&apos;t configured
              or there are no confirmed subscribers.
            </p>
            <form
              method="POST"
              action={`/admin/editions/${edition.id}/distribute/send-newsletter`}
              data-loading-submit
            >
              <button
                type="submit"
                data-loading-text="Sending…"
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                <span className="material-icons text-sm">mail</span> Send Newsletter
              </button>
            </form>
          </div>
        </section>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var target = document.getElementById(btn.getAttribute('data-copy-target'));
                if (!target) return;
                navigator.clipboard.writeText(target.value).then(function () {
                  var original = btn.textContent;
                  btn.textContent = 'Copied!';
                  setTimeout(function () { btn.textContent = original; }, 1500);
                });
              });
            });
          `,
        }}
      />
    </NewspaperShell>
  );
}

function NetworkCard({
  label,
  connected,
  action,
  defaultValue,
  limit,
}: {
  label: string;
  connected: boolean;
  action: string;
  defaultValue: string;
  limit: number;
}) {
  return (
    <div className="border border-stone-200 bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-headline font-bold text-base">{label}</h4>
        <span
          className={`text-[9px] font-sans font-bold uppercase tracking-widest px-1.5 py-0.5 ${
            connected ? "text-green-700 bg-green-50" : "text-stone-400 bg-stone-100"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <form method="POST" action={action} className="flex flex-col flex-1" data-loading-submit>
        <textarea
          name="text"
          defaultValue={defaultValue}
          maxLength={limit}
          rows={6}
          disabled={!connected}
          className="w-full flex-1 bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-serif leading-relaxed disabled:bg-stone-50 disabled:text-stone-400"
        />
        <p className="text-[10px] font-sans text-stone-400 mt-1 mb-3">Limit: {limit} characters</p>
        {connected ? (
          <button
            type="submit"
            data-loading-text="Sending…"
            className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
          >
            Send to {label}
          </button>
        ) : (
          <a
            href="/admin/social"
            className="block text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-ink hover:text-ink transition-colors"
          >
            Connect {label}
          </a>
        )}
      </form>
    </div>
  );
}

function CopyBox({
  id,
  label,
  defaultValue,
}: {
  id: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="border border-stone-200 bg-white p-5 flex flex-col">
      <h4 className="font-headline font-bold text-base mb-3">{label}</h4>
      <textarea
        id={id}
        defaultValue={defaultValue}
        rows={8}
        className="w-full flex-1 bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-serif leading-relaxed mb-3"
      />
      <button
        type="button"
        data-copy-target={id}
        className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
      >
        Copy to Clipboard
      </button>
    </div>
  );
}
