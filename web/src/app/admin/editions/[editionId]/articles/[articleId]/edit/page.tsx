/**
 * Edit a single article — ported from `admin.article_edit`
 * (`app/routes/admin.py:421-464`) and `app/templates/admin/article_edit.html`.
 *
 * POSTs to the sibling `.../update` route (see the edition-edit page's note
 * on why the GET and POST halves live at adjacent URLs here).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { readFlash } from "@/lib/flash";
import { mediaUrl } from "@/lib/media";
import { toDateInputValue } from "@/lib/date-input";
import { ARTICLE_CATEGORIES } from "@/lib/article-categories";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Pull the `calendar_event` notes-source indicator back out of `sourceData`, if present. */
function readCalendarNotesSource(sourceData: string | null): string | null {
  if (!sourceData) return null;
  try {
    const parsed = JSON.parse(sourceData) as {
      source_type?: unknown;
      source_metadata?: { notesSource?: unknown };
    };
    if (parsed.source_type !== "calendar_event") return null;
    const notesSource = parsed.source_metadata?.notesSource;
    return typeof notesSource === "string" ? notesSource : null;
  } catch {
    return null;
  }
}

async function loadArticle(editionId: string, articleId: string) {
  const eId = parseId(editionId);
  const aId = parseId(articleId);
  if (eId === null || aId === null) return null;

  const [edition, article] = await Promise.all([
    prisma.edition.findUnique({ where: { id: eId } }),
    prisma.article.findUnique({ where: { id: aId } }),
  ]);
  if (!edition || !article || article.editionId !== eId) return null;
  return { edition, article };
}

export async function generateMetadata({
  params,
}: PageProps<"/admin/editions/[editionId]/articles/[articleId]/edit">): Promise<Metadata> {
  const { editionId, articleId } = await params;
  const loaded = await loadArticle(editionId, articleId);
  return { title: loaded ? `Edit Article — ${loaded.edition.title}` : "Article Not Found - Admin" };
}

export default async function ArticleEditPage({
  params,
  searchParams,
}: PageProps<"/admin/editions/[editionId]/articles/[articleId]/edit">) {
  const { editionId, articleId } = await params;
  const query = await searchParams;
  const messages = readFlash(query);

  const loaded = await loadArticle(editionId, articleId);
  if (!loaded) notFound();
  const { edition, article } = loaded;

  const imageSrc = mediaUrl(article.image);
  const audioSrc = mediaUrl(article.audio);
  const calendarNotesSource = readCalendarNotesSource(article.sourceData);

  return (
    <NewspaperShell endpoint="admin.article_edit">
      <div className="max-w-4xl mx-auto pb-16 fade-in">
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
          <span className="text-ink font-bold truncate max-w-[200px]">{article.title}</span>
        </div>

        <FlashBanner messages={messages} />

        <div className="border-2 border-ink p-8 bg-paper shadow-xl">
          <div className="text-center mb-8 border-b-4 border-double border-ink pb-5">
            <p className="text-[10px] font-sans uppercase tracking-widest text-stone-500 mb-1">
              {edition.title}
              {article.sourceType === "ai_generated" && (
                <>
                  {" "}
                  · <span className="text-purple-600">AI Generated</span>
                </>
              )}
            </p>
            <h2 className="font-masthead text-4xl">Edit Article</h2>
          </div>

          <form
            method="POST"
            action={`/admin/editions/${edition.id}/articles/${article.id}/update`}
            encType="multipart/form-data"
            className="space-y-7 font-serif"
          >
            {/* Headline */}
            <div>
              <label className="block text-xs font-sans font-bold uppercase tracking-widest mb-2 border-b border-ink pb-1">
                Headline / Title *
              </label>
              <input
                type="text"
                name="title"
                defaultValue={article.title}
                required
                className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-3 text-2xl font-headline"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Section
                </label>
                <select
                  name="category"
                  defaultValue={article.category}
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans appearance-none"
                >
                  {ARTICLE_CATEGORIES.map((cat) => (
                    <option key={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  By-line
                </label>
                <input
                  type="text"
                  name="author"
                  defaultValue={article.author ?? ""}
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans italic"
                />
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Date
                </label>
                <input
                  type="date"
                  name="date"
                  defaultValue={article.date ? toDateInputValue(article.date) : ""}
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                />
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Order
                </label>
                <input
                  type="number"
                  name="order"
                  defaultValue={article.order}
                  min={0}
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                />
              </div>
            </div>

            {/* Drop cap letter */}
            <div className="max-w-xs">
              <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                Drop Cap Letter
              </label>
              <input
                type="text"
                name="deck"
                defaultValue={article.deck}
                maxLength={1}
                className="w-16 bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-2xl font-masthead text-center uppercase"
              />
            </div>

            {/* Content */}
            <div>
              <label className="block text-xs font-sans font-bold uppercase tracking-widest mb-2 border-b-2 border-ink pb-1">
                Article Content (Markdown) *
              </label>
              <textarea
                name="content"
                rows={18}
                required
                defaultValue={article.content}
                className="w-full bg-transparent border-2 border-ink p-5 font-serif text-base leading-relaxed focus:ring-0 focus:border-ink-light"
              />
              <p className="mt-1 text-[10px] font-sans uppercase tracking-widest text-stone-500">
                Use **bold**, *italic*, # Headers to format.
              </p>
            </div>

            {/* Media */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-stone-50 p-5 border border-dashed border-stone-300">
              <h4 className="col-span-full text-xs font-sans font-bold uppercase tracking-widest mb-1 border-b border-stone-300 pb-2">
                Supporting Media
              </h4>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Image
                </label>
                {imageSrc && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageSrc}
                    alt=""
                    className="w-full h-20 object-cover mb-2 border border-stone-300 grayscale"
                  />
                )}
                <input
                  type="file"
                  name="image"
                  accept="image/*"
                  className="w-full text-xs font-sans file:mr-2 file:py-1 file:px-3 file:border-0 file:text-xs file:font-bold file:uppercase file:bg-ink file:text-paper hover:file:bg-ink-light"
                />
                <p className="text-[9px] text-stone-400 mt-1">Leave empty to keep existing image.</p>
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Audio
                </label>
                {audioSrc && (
                  <audio controls className="w-full h-8 mb-2">
                    <source src={audioSrc} />
                  </audio>
                )}
                <input
                  type="file"
                  name="audio"
                  accept="audio/*"
                  className="w-full text-xs font-sans file:mr-2 file:py-1 file:px-3 file:border-0 file:text-xs file:font-bold file:uppercase file:bg-ink file:text-paper hover:file:bg-ink-light"
                />
                <p className="text-[9px] text-stone-400 mt-1">Leave empty to keep existing audio.</p>
                <button
                  type="submit"
                  formAction={`/admin/editions/${edition.id}/articles/${article.id}/generate-audio`}
                  className="mt-2 w-full px-3 py-2 text-[10px] font-bold font-sans uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                >
                  Generate Audio (AI)
                </button>
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Video URL (YouTube / Vimeo)
                </label>
                <input
                  type="url"
                  name="video_url"
                  defaultValue={article.video ?? ""}
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-xs font-sans"
                />
              </div>
            </div>

            {/* Calendar-event source indicator (Phase F) */}
            {calendarNotesSource && (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 p-4 text-xs font-sans text-blue-900">
                <span className="material-icons text-blue-600">event_note</span>
                <p className="flex-1">
                  Sourced from a calendar event.{" "}
                  {calendarNotesSource === "gemini_notes_doc"
                    ? "Gemini meeting notes were found and used as the source text."
                    : "No meeting notes were found — the event's title, description, and attendees were used instead."}
                </p>
              </div>
            )}

            {/* AI Regenerate (if applicable) */}
            {article.sourceType === "ai_generated" && (
              <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 p-4">
                <span className="material-icons text-purple-600">auto_awesome</span>
                <p className="text-xs font-sans text-purple-800 flex-1">
                  This article was generated by AI. You can regenerate it to get a fresh
                  draft.
                </p>
                <button
                  type="submit"
                  formAction={`/admin/editions/${edition.id}/articles/${article.id}/regenerate`}
                  className="px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-purple-700 text-white hover:bg-purple-800 transition-colors"
                >
                  Regenerate
                </button>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t-4 border-double border-ink">
              <a
                href={`/admin/editions/${edition.id}/edit`}
                className="flex-1 text-center px-4 py-3 text-xs font-bold font-sans uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Cancel
              </a>
              <button
                type="submit"
                className="flex-1 px-4 py-3 text-xs font-bold font-sans uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      </div>
    </NewspaperShell>
  );
}
