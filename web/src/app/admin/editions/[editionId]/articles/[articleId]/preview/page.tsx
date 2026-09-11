/**
 * Admin-only article preview — the article-level counterpart to
 * `/admin/editions/[editionId]/preview` (the edition-level preview). The
 * public `/article/[articleId]` route 404s unless the parent edition is
 * published (`isPublished`, `edition-helpers.ts`); this route reuses that
 * same layout but is gated only by the `/admin/*` proxy auth, so drafts can
 * be reviewed article-by-article before publishing.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import { prisma } from "@/lib/prisma";
import { editionArticles } from "@/lib/editions";
import { toEditionHeaderInfo, articleHref } from "@/lib/issue-view";
import { periodLabel, periodLabelShort } from "@/lib/edition-helpers";
import { renderMarkdown } from "@/lib/markdown";
import { mediaUrl } from "@/lib/media";

export const dynamic = "force-dynamic";

/** Flask's `<int:...>` converter: digits only. */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function loadArticle(editionId: string, articleId: string) {
  const eid = parseId(editionId);
  const aid = parseId(articleId);
  if (eid === null || aid === null) return null;

  const article = await prisma.article.findUnique({
    where: { id: aid },
    include: {
      edition: {
        select: {
          id: true,
          cadence: true,
          periodStart: true,
          periodEnd: true,
          title: true,
          status: true,
          vol: true,
          coverImage: true,
        },
      },
    },
  });
  if (article === null || article.editionId !== eid) return null;
  return article;
}

export async function generateMetadata({
  params,
}: PageProps<"/admin/editions/[editionId]/articles/[articleId]/preview">): Promise<Metadata> {
  const { editionId, articleId } = await params;
  const article = await loadArticle(editionId, articleId);
  return {
    title: article ? `Preview: ${article.title} - Admin` : "Article Not Found - Admin",
  };
}

export default async function AdminArticlePreviewPage({
  params,
}: PageProps<"/admin/editions/[editionId]/articles/[articleId]/preview">) {
  const { editionId, articleId } = await params;
  const article = await loadArticle(editionId, articleId);
  if (article === null) notFound();

  const edition = article.edition;

  const [siblings, prevArticle, nextArticle] = await Promise.all([
    editionArticles(edition.id),
    prisma.article.findFirst({
      where: { editionId: article.editionId, order: { lt: article.order } },
      orderBy: { order: "desc" },
      select: { id: true, title: true },
    }),
    prisma.article.findFirst({
      where: { editionId: article.editionId, order: { gt: article.order } },
      orderBy: { order: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  const imageSrc = mediaUrl(article.image);
  const videoSrc = mediaUrl(article.video);
  const audioSrc = mediaUrl(article.audio);

  return (
    <NewspaperShell
      endpoint="admin.edition_preview"
      article={{ edition: toEditionHeaderInfo(edition) }}
    >
      {/* Article Layout: Matching Issue Grid */}
      <div className="grid grid-cols-12 gap-6 lg:gap-8 relative">
        {/* Sidebar (Left): Navigation & Context (3 Cols) */}
        <aside className="col-span-12 lg:col-span-3 lg:border-r lg:border-stone-300 lg:pr-6 flex flex-col order-2 lg:order-1">
          {/* Back Link */}
          <div className="mb-8 border-b border-ink pb-4">
            <a href={`/admin/editions/${edition.id}/preview`} className="flex items-center group">
              <span className="material-icons text-sm mr-2 group-hover:-translate-x-1 transition-transform">
                arrow_back
              </span>
              <div className="flex flex-col">
                <span className="font-sans text-[10px] uppercase tracking-widest text-stone-500">
                  Back to Edition Preview
                </span>
                <span className="font-headline font-bold text-lg leading-none">
                  {periodLabelShort(edition)}
                </span>
              </div>
            </a>
          </div>

          {/* In This Issue List */}
          <div className="mb-8">
            <h5 className="font-sans text-[10px] font-bold uppercase tracking-widest border-b border-stone-300 pb-2 mb-3 text-stone-500">
              In This Issue
            </h5>
            <ul className="space-y-3 text-xs font-headline">
              {siblings.map((item) => (
                <li
                  key={item.id}
                  className={
                    item.id === article.id
                      ? "pl-2 border-l-2 border-ink font-bold"
                      : "opacity-70 hover:opacity-100"
                  }
                >
                  <a href={articleHref(edition.id, item.id, true)} className="block leading-snug">
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Next/Prev specific links */}
          <div className="mt-auto hidden lg:block border-t border-stone-300 pt-4">
            {prevArticle && (
              <a
                href={articleHref(edition.id, prevArticle.id, true)}
                className="block mb-4 group opacity-60 hover:opacity-100"
              >
                <span className="text-[9px] uppercase tracking-widest text-stone-500">
                  Previous Article
                </span>
                <p className="font-bold leading-tight group-hover:underline">
                  {prevArticle.title}
                </p>
              </a>
            )}

            {nextArticle && (
              <a
                href={articleHref(edition.id, nextArticle.id, true)}
                className="block group opacity-60 hover:opacity-100 text-right"
              >
                <span className="text-[9px] uppercase tracking-widest text-stone-500">
                  Next Article
                </span>
                <p className="font-bold leading-tight group-hover:underline">
                  {nextArticle.title}
                </p>
              </a>
            )}
          </div>
        </aside>

        {/* Main Content (Right/Center): 9 Cols */}
        <article className="col-span-12 lg:col-span-9 lg:pl-2 order-1 lg:order-2">
          {/* Category & Meta */}
          <div className="flex items-center gap-4 mb-6 border-b border-dotted border-stone-400 pb-2">
            <span className="inline-block text-[10px] font-sans font-bold uppercase tracking-widest text-white bg-ink px-2 py-0.5">
              {article.category}
            </span>
            <span className="font-sans text-[10px] uppercase tracking-widest text-stone-500">
              {periodLabel(edition)}
            </span>
            {article.author && (
              <span className="ml-auto font-sans text-[10px] uppercase tracking-widest text-stone-500">
                By {article.author}
              </span>
            )}
          </div>

          {/* Headline */}
          <h1 className="font-headline text-5xl md:text-6xl font-black leading-none mb-8">
            {article.title}
          </h1>

          {/* Media/Lead Image */}
          {imageSrc && (
            <figure className="mb-8 w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageSrc}
                alt={article.title}
                className="w-full h-auto border border-stone-300 p-1 bg-white grayscale hover:grayscale-0 transition-all duration-1000"
              />
            </figure>
          )}

          {/* Two Column Text Layout for Content */}
          <div className="content-body font-body text-lg leading-relaxed justified-text text-ink-light space-y-6 md:columns-2 md:gap-8 md:space-y-0 text-justify">
            {/* Rich Media Injections (Video/Audio) - Place at top of first column */}
            {(videoSrc || audioSrc) && (
              <div className="break-inside-avoid mb-6">
                {videoSrc && (
                  <div className="mb-4">
                    <video
                      controls
                      className="w-full border border-stone-300 p-1 bg-white"
                    >
                      <source src={videoSrc} />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                )}

                {audioSrc && (
                  <div className="bg-stone-100 p-3 border border-stone-300">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-icons text-stone-500 text-sm">
                        headphones
                      </span>
                      <span className="text-[10px] font-bold uppercase text-stone-500">
                        Audio Content
                      </span>
                    </div>
                    <audio controls className="w-full h-8">
                      <source src={audioSrc} />
                    </audio>
                  </div>
                )}
              </div>
            )}

            {/* Drop Cap for first P */}
            <div
              className="first-p-drop-cap"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content) }}
            />
          </div>

          {/* Footer / End Mark */}
          <div className="mt-12 flex justify-center">
            <span className="text-stone-400">###</span>
          </div>

          {/* Mobile Nav (Visible only on small screens) */}
          <div className="lg:hidden mt-12 pt-6 border-t border-stone-300 flex justify-between">
            {prevArticle ? (
              <a
                href={articleHref(edition.id, prevArticle.id, true)}
                className="text-xs font-bold uppercase text-stone-500"
              >
                ← Previous
              </a>
            ) : (
              <span></span>
            )}
            {nextArticle && (
              <a
                href={articleHref(edition.id, nextArticle.id, true)}
                className="text-xs font-bold uppercase text-stone-500"
              >
                Next →
              </a>
            )}
          </div>
        </article>
      </div>
    </NewspaperShell>
  );
}
