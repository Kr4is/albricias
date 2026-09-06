/**
 * Assisted article generation form — ported from `admin.article_generate`
 * (`app/routes/admin.py:523-543`, GET half) and
 * `app/templates/admin/article_generate.html`, including its show/hide
 * scripting for the source-type / generator-type conditional fields.
 *
 * POSTs (multipart, for the optional audio upload) to the sibling
 * `.../generate/run` route.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { readFlash } from "@/lib/flash";
import { toDateInputValue } from "@/lib/date-input";
import { SOURCES } from "@/lib/sources";
import { DEFAULT_AUTHOR } from "@/lib/generation";
import { GENERATORS } from "@/mastra/schemas";

export const dynamic = "force-dynamic";

const SOURCE_ICONS: Record<string, string> = {
  audio_monologue: "mic",
  audio_conversation: "record_voice_over",
  text: "article",
  notes: "notes",
};

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  audio_monologue: "You talking solo — a reflection, a report, a rant.",
  audio_conversation: "A recorded discussion, interview, or dialogue.",
  text: "An existing transcript or prose passage.",
  notes: "Rough bullet points or ideas to be expanded.",
};

const GENERATOR_ICONS: Record<string, string> = {
  reflection: "psychology",
  interview: "question_answer",
  review: "star_rate",
  profile: "person",
};

const GENERATOR_DESCRIPTIONS: Record<string, string> = {
  reflection: "A first-person editorial or opinion essay.",
  interview: "A polished Q&A with editorial introduction.",
  review: "A structured critique with a clear verdict.",
  profile: "A narrative feature spotlighting a person or project.",
};

const GENERATOR_BEST_WITH: Record<string, string> = {
  reflection: "Best with: monologue, notes",
  interview: "Best with: conversation, transcription",
  review: "Best with: notes, text",
  profile: "Best with: conversation, notes",
};

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

export const metadata: Metadata = { title: "Generate Article - Admin" };

export default async function ArticleGeneratePage({
  params,
  searchParams,
}: PageProps<"/admin/editions/[editionId]/articles/generate">) {
  const { editionId } = await params;
  const query = await searchParams;
  const messages = readFlash(query);

  const edition = await loadEdition(editionId);
  if (!edition) notFound();

  const defaultDate = toDateInputValue(edition.periodStart);
  const sourceEntries = Object.entries(SOURCES);
  const generatorEntries = Object.entries(GENERATORS);

  return (
    <NewspaperShell endpoint="admin.article_generate">
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
          <span className="text-ink font-bold">Generate Article</span>
        </div>

        <FlashBanner messages={messages} />

        <div className="border-2 border-ink p-8 bg-paper shadow-xl">
          <div className="text-center mb-8 border-b-4 border-double border-ink pb-5">
            <p className="text-[10px] font-sans uppercase tracking-widest text-stone-500 mb-1">
              {edition.title} · AI Assisted
            </p>
            <h2 className="font-masthead text-4xl">Generate Article</h2>
            <p className="mt-2 text-xs font-sans italic text-stone-500">
              Provide a source, choose an article type, and let the correspondent do
              the rest.
            </p>
          </div>

          <form
            method="POST"
            action={`/admin/editions/${edition.id}/articles/generate/run`}
            encType="multipart/form-data"
            className="space-y-8 font-serif"
            id="generate-form"
          >
            {/* Step 1: Source */}
            <fieldset>
              <legend className="w-full text-xs font-sans font-bold uppercase tracking-widest border-b-2 border-ink pb-2 mb-4 flex items-center gap-2">
                <span className="material-icons text-sm">input</span>
                Step 1 — Choose Your Source
              </legend>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {sourceEntries.map(([key, label], index) => (
                  <label
                    key={key}
                    className="source-card flex items-start gap-3 p-4 border-2 border-stone-200 cursor-pointer hover:border-ink transition-colors has-[:checked]:border-ink has-[:checked]:bg-stone-50"
                  >
                    <input
                      type="radio"
                      name="source_type"
                      value={key}
                      defaultChecked={index === 0}
                      className="mt-1 accent-ink source-radio"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-icons text-base text-stone-400">
                          {SOURCE_ICONS[key]}
                        </span>
                        <span className="text-sm font-sans font-bold">{label}</span>
                      </div>
                      <p className="text-[11px] font-sans text-stone-500 mt-0.5 leading-snug">
                        {SOURCE_DESCRIPTIONS[key]}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              <div id="audio-input-section" className="space-y-2">
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Audio File *
                </label>
                <input
                  type="file"
                  name="audio_file"
                  accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,.ogg,.flac,audio/*"
                  className="w-full text-sm font-sans file:mr-3 file:py-2 file:px-4 file:border-0 file:text-xs file:font-bold file:uppercase file:tracking-widest file:bg-ink file:text-paper hover:file:bg-ink-light"
                />
                <p className="text-[10px] font-sans text-stone-400">
                  Supported: mp3, wav, m4a, webm, ogg, flac
                </p>
              </div>

              <div id="text-input-section" className="hidden space-y-2">
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Paste your text or notes *
                </label>
                <textarea
                  name="text_input"
                  rows={10}
                  className="w-full bg-transparent border-2 border-ink p-4 font-serif text-sm leading-relaxed focus:ring-0 focus:border-ink-light"
                  placeholder="Paste a transcription, your notes, or rough bullet points here…"
                />
              </div>
            </fieldset>

            {/* Step 2: Article Type */}
            <fieldset>
              <legend className="w-full text-xs font-sans font-bold uppercase tracking-widest border-b-2 border-ink pb-2 mb-4 flex items-center gap-2">
                <span className="material-icons text-sm">auto_awesome</span>
                Step 2 — Choose Article Type
              </legend>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {generatorEntries.map(([key, label], index) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 p-4 border-2 border-stone-200 cursor-pointer hover:border-ink transition-colors has-[:checked]:border-ink has-[:checked]:bg-stone-50"
                  >
                    <input
                      type="radio"
                      name="generator_type"
                      value={key}
                      defaultChecked={index === 0}
                      className="mt-1 accent-ink generator-radio"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-icons text-base text-stone-400">
                          {GENERATOR_ICONS[key]}
                        </span>
                        <span className="text-sm font-sans font-bold">{label}</span>
                      </div>
                      <p className="text-[11px] font-sans text-stone-500 mt-0.5 leading-snug">
                        {GENERATOR_DESCRIPTIONS[key]}
                      </p>
                      <p className="text-[10px] font-sans text-stone-400 mt-0.5 italic">
                        {GENERATOR_BEST_WITH[key]}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Step 3: Optional context */}
            <fieldset>
              <legend className="w-full text-xs font-sans font-bold uppercase tracking-widest border-b border-stone-200 pb-2 mb-4 flex items-center gap-2 text-stone-500">
                <span className="material-icons text-sm">tune</span>
                Step 3 — Optional Context
              </legend>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Focus / Topic Hint
                  </label>
                  <input
                    type="text"
                    name="topic_hint"
                    placeholder="e.g. focus on the challenges of remote work, or the impact of AI on journalism"
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                  />
                  <p className="text-[10px] text-stone-400 mt-0.5">
                    Optional extra instruction to guide the AI&apos;s focus.
                  </p>
                </div>

                <div id="interview-fields" className="hidden">
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    Interviewee Name
                  </label>
                  <input
                    type="text"
                    name="interviewee_name"
                    placeholder="e.g. Jane Smith"
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                  />
                </div>

                <div id="subject-fields" className="hidden space-y-4">
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Subject Name
                    </label>
                    <input
                      type="text"
                      name="subject_name"
                      placeholder="e.g. The Pragmatic Programmer, or Notion"
                      className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                    />
                  </div>
                  <div id="subject-type-field">
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Subject Type
                    </label>
                    <select
                      name="subject_type"
                      defaultValue="other"
                      className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans appearance-none"
                    >
                      <option value="other">— Select —</option>
                      <option value="book">Book</option>
                      <option value="film">Film</option>
                      <option value="tool">Software / Tool</option>
                      <option value="restaurant">Restaurant</option>
                      <option value="album">Album / Music</option>
                    </select>
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Step 4: Article metadata */}
            <fieldset>
              <legend className="w-full text-xs font-sans font-bold uppercase tracking-widest border-b border-stone-200 pb-2 mb-4 flex items-center gap-2 text-stone-500">
                <span className="material-icons text-sm">edit_note</span>
                Step 4 — Article Metadata
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                    By-line
                  </label>
                  <input
                    type="text"
                    name="author"
                    defaultValue={DEFAULT_AUTHOR}
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
                    defaultValue={defaultDate}
                    className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
                  />
                </div>
              </div>
            </fieldset>

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
                id="generate-btn"
                className="flex-2 flex-grow-[2] inline-flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold font-sans uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
              >
                <span className="material-icons text-sm" id="generate-icon">
                  auto_awesome
                </span>
                <span id="generate-label">Generate Article</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var form = document.getElementById('generate-form');
              var audioSection = document.getElementById('audio-input-section');
              var textSection = document.getElementById('text-input-section');
              var interviewFields = document.getElementById('interview-fields');
              var subjectFields = document.getElementById('subject-fields');
              var subjectTypeField = document.getElementById('subject-type-field');
              var generateBtn = document.getElementById('generate-btn');
              var generateIcon = document.getElementById('generate-icon');
              var generateLabel = document.getElementById('generate-label');

              function updateSourcePanel() {
                var selected = document.querySelector('input[name="source_type"]:checked');
                if (!selected) return;
                var isAudio = selected.value.indexOf('audio_') === 0;
                audioSection.classList.toggle('hidden', !isAudio);
                textSection.classList.toggle('hidden', isAudio);
              }

              function updateGeneratorPanel() {
                var selected = document.querySelector('input[name="generator_type"]:checked');
                if (!selected) return;
                interviewFields.classList.toggle('hidden', selected.value !== 'interview');
                subjectFields.classList.toggle('hidden', ['review', 'profile'].indexOf(selected.value) === -1);
                subjectTypeField.classList.toggle('hidden', selected.value !== 'review');
              }

              document.querySelectorAll('input[name="source_type"]').forEach(function (radio) {
                radio.addEventListener('change', updateSourcePanel);
              });
              document.querySelectorAll('input[name="generator_type"]').forEach(function (radio) {
                radio.addEventListener('change', updateGeneratorPanel);
              });

              form.addEventListener('submit', function () {
                generateBtn.disabled = true;
                generateIcon.textContent = 'hourglass_top';
                generateLabel.textContent = 'Generating…';
              });

              updateSourcePanel();
              updateGeneratorPanel();
            })();
          `,
        }}
      />
    </NewspaperShell>
  );
}
