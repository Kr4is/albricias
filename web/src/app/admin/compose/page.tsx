/**
 * Editor's Desk — quick article composer, ported from `compose.compose_article`
 * (`app/routes/compose.py`) and `app/templates/compose.html`.
 *
 * Flagged by the Phase 4 notes as deliberately skipped there (it's a
 * data-mutating admin form, and depends on `save_media_file`, which this
 * phase owns). POSTs to the sibling `/admin/compose/create` route, which
 * auto-creates the target Edition from the article's date under the current
 * cadence when no edition is explicitly picked.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { readFlash } from "@/lib/flash";
import { toDateInputValue } from "@/lib/date-input";
import { ARTICLE_CATEGORIES } from "@/lib/article-categories";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Compose Article - Admin" };

export default async function ComposePage({
  searchParams,
}: PageProps<"/admin/compose">) {
  const query = await searchParams;
  const messages = readFlash(query);

  const editions = await prisma.edition.findMany({
    orderBy: { periodStart: "desc" },
    select: { id: true, title: true, status: true },
  });

  const today = toDateInputValue(new Date());

  return (
    <NewspaperShell endpoint="admin.compose">
      <div className="max-w-4xl mx-auto my-8 fade-in">
        <div className="border-2 border-ink p-8 bg-paper shadow-xl relative">
          <div className="text-center mb-10 border-b-4 border-ink border-double pb-6">
            <h2 className="font-masthead text-5xl md:text-6xl mb-2">Editor&apos;s Desk</h2>
            <p className="font-sans text-xs uppercase tracking-[0.3em] font-bold text-ink-light">
              New Article Composition
            </p>
          </div>

          <FlashBanner messages={messages} />

          <form
            method="POST"
            action="/admin/compose/create"
            encType="multipart/form-data"
            className="space-y-8 font-serif"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column */}
              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="title"
                    className="block text-xs font-sans font-extrabold uppercase tracking-widest mb-2 border-b border-ink pb-1"
                  >
                    Headline / Title
                  </label>
                  <input
                    type="text"
                    name="title"
                    id="title"
                    required
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-3 text-2xl font-headline placeholder:italic"
                    placeholder="Enter a gripping headline..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="category"
                      className="block text-xs font-sans font-extrabold uppercase tracking-widest mb-2 border-b border-ink pb-1"
                    >
                      Section
                    </label>
                    <select
                      name="category"
                      id="category"
                      required
                      defaultValue="General"
                      className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm uppercase tracking-wider appearance-none"
                    >
                      {ARTICLE_CATEGORIES.map((cat) => (
                        <option key={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="date"
                      className="block text-xs font-sans font-extrabold uppercase tracking-widest mb-2 border-b border-ink pb-1"
                    >
                      Date of Report
                    </label>
                    <input
                      type="date"
                      name="date"
                      id="date"
                      required
                      defaultValue={today}
                      className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="author"
                    className="block text-xs font-sans font-extrabold uppercase tracking-widest mb-2 border-b border-ink pb-1"
                  >
                    By-line (Author)
                  </label>
                  <input
                    type="text"
                    name="author"
                    id="author"
                    defaultValue="Staff Writer"
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-lg italic"
                    placeholder="Your name..."
                  />
                </div>

                <div>
                  <label
                    htmlFor="edition_id"
                    className="block text-xs font-sans font-extrabold uppercase tracking-widest mb-2 border-b border-ink pb-1"
                  >
                    Add to Edition
                  </label>
                  <select
                    name="edition_id"
                    id="edition_id"
                    defaultValue=""
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans appearance-none"
                  >
                    <option value="">— Create / match by date —</option>
                    {editions.map((edition) => (
                      <option key={edition.id} value={edition.id}>
                        {edition.title} ({edition.status})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[9px] font-sans text-stone-400 uppercase tracking-wider">
                    Leave blank to auto-assign by article date
                  </p>
                </div>
              </div>

              {/* Right Column: Media */}
              <div className="space-y-5 bg-stone-100/50 p-6 border-l-2 border-ink border-dotted">
                <h3 className="text-xs font-sans font-extrabold uppercase tracking-widest mb-4 text-center border-b border-ink pb-2 italic">
                  Supporting Media
                </h3>

                <div>
                  <label
                    htmlFor="image"
                    className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1"
                  >
                    Illustration / Photograph (JPG/PNG)
                  </label>
                  <input
                    type="file"
                    name="image"
                    id="image"
                    accept="image/*"
                    className="w-full text-xs font-serif text-stone-600 file:mr-4 file:py-2 file:px-4 file:border-0 file:text-xs file:font-sans file:font-bold file:uppercase file:bg-ink file:text-paper hover:file:bg-ink-light transition-all"
                  />
                  <p className="mt-1 text-[9px] text-stone-400 font-sans">
                    Auto-compressed to max 1200px wide.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="audio"
                    className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1 mt-4"
                  >
                    Audio Correspondence (MP3/WAV)
                  </label>
                  <input
                    type="file"
                    name="audio"
                    id="audio"
                    accept="audio/*"
                    className="w-full text-xs font-serif text-stone-600 file:mr-4 file:py-2 file:px-4 file:border-0 file:text-xs file:font-sans file:font-bold file:uppercase file:bg-ink file:text-paper hover:file:bg-ink-light transition-all"
                  />
                </div>

                <div>
                  <label
                    htmlFor="video_url"
                    className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1 mt-4"
                  >
                    Video URL (YouTube / Vimeo embed)
                  </label>
                  <input
                    type="url"
                    name="video_url"
                    id="video_url"
                    placeholder="https://youtube.com/watch?v=..."
                    className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-xs font-sans"
                  />
                  <p className="mt-1 text-[9px] text-stone-400 font-sans">
                    Paste a video URL — no file upload for video.
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-ink border-dotted text-[9px] text-stone-500 italic uppercase tracking-wider text-center">
                  Image &amp; audio max: 50MB
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div>
              <label
                htmlFor="content"
                className="block text-xs font-sans font-extrabold uppercase tracking-widest mb-4 border-b-2 border-ink pb-1"
              >
                Article Narrative (Markdown Supported)
              </label>
              <div className="relative">
                <textarea
                  name="content"
                  id="content"
                  rows={15}
                  required
                  className="w-full bg-transparent border-2 border-ink p-6 font-serif text-lg leading-relaxed justified-text focus:ring-0 focus:border-ink-light placeholder:italic shadow-inner"
                  placeholder="Once upon a time in the heart of the city..."
                />
                <div className="absolute bottom-4 right-4 text-ink-light opacity-50 select-none pointer-events-none">
                  <span className="material-symbols-outlined text-4xl">edit_square</span>
                </div>
              </div>
              <p className="mt-2 text-[10px] font-sans uppercase tracking-widest text-stone-500 text-right">
                Use **bold**, *italic*, # Headers, or [links](url) to format your
                story.
              </p>
            </div>

            <div className="pt-6 border-t-4 border-ink border-double">
              <button
                type="submit"
                className="w-full bg-ink text-paper py-4 font-sans font-extrabold uppercase tracking-[0.4em] text-xl hover:bg-ink-light hover:scale-[1.01] active:scale-[0.99] transition-all duration-300 shadow-2xl"
              >
                Save to Edition
              </button>
            </div>
          </form>

          <div className="mt-10 text-center flex items-center justify-center gap-4 text-ink-light opacity-60">
            <div className="h-px w-12 bg-ink"></div>
            <span className="font-masthead text-2xl">¡Albricias!</span>
            <div className="h-px w-12 bg-ink"></div>
          </div>
        </div>
      </div>
    </NewspaperShell>
  );
}
