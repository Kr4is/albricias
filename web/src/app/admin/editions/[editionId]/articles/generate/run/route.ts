/**
 * POST half of the assisted generation form at `.../articles/generate`
 * (`admin.article_generate` in `app/routes/admin.py:545-614`).
 *
 * Async like `.../topic-candidates/[candidateId]/regenerate/route.ts`: the
 * response comes back as soon as the edition flips to
 * `generationStatus: "running"`, and the generation itself runs in `after()`.
 * It used to be awaited inline here, which held the admin's browser open for
 * the entire run — for a `profile` piece that is a five-step workflow and
 * minutes of model time, with no progress shown and nothing surviving a
 * reload. Now it feeds the same `/live` SSE banner (step-aware for the profile
 * workflow) every other long-running piece uses.
 */

import { after, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  beginManualArticleGeneration,
  finishManualArticleGeneration,
  DEFAULT_AUTHOR,
} from "@/lib/generation";
import type { SourceType } from "@/lib/sources";
import type { GeneratorType, ReviewSubjectType } from "@/mastra/schemas";
import { parseDateInputValue } from "@/lib/date-input";
import { getSetting } from "@/lib/config/settings";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { flashRedirect } from "@/lib/flash";

/** Pull `source_metadata.notesSource` back out of a persisted article's `sourceData` JSON, if present. */
function readNotesSource(sourceData: string | null): string | null {
  if (!sourceData) return null;
  try {
    const parsed = JSON.parse(sourceData) as { source_metadata?: { notesSource?: unknown } };
    const notesSource = parsed.source_metadata?.notesSource;
    return typeof notesSource === "string" ? notesSource : null;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, `/admin/editions/${id}/edit`, [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const form = await request.formData();
  const sourceType = form.get("source_type")?.toString() ?? "";
  const generatorType = form.get("generator_type")?.toString() ?? "";

  if (!sourceType || !generatorType) {
    return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
      { type: "error", text: "Please select both a source type and an article type." },
    ]);
  }

  let audioFile: File | undefined;
  let audioFilename = "";
  let audioApiKey: string | undefined;
  let textInput = "";
  let calendarId: string | undefined;
  let googleEventId: string | undefined;
  let githubRepo: string | undefined;

  if (sourceType.startsWith("audio_")) {
    const file = form.get("audio_file");
    if (!(file instanceof File) || file.size === 0) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        { type: "error", text: "Please upload an audio file." },
      ]);
    }
    // Whisper transcription is OpenAI-only regardless of the configured text
    // provider — see `audioApiKey` on `GenerateArticleFromSourceOptions`.
    audioApiKey = await getSetting("integrations.openai.apiKey", { encrypted: true });
    if (!audioApiKey) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        {
          type: "error",
          text: "Audio transcription requires an OpenAI API key (Whisper) — set it at /admin/settings, or use Text/Notes input instead.",
        },
      ]);
    }
    audioFile = file;
    audioFilename = file.name;
  } else if (sourceType === "calendar_event") {
    const raw = form.get("calendar_event")?.toString() ?? "";
    const [rawCalendarId, rawEventId] = raw.split("::");
    if (!rawCalendarId || !rawEventId) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        { type: "error", text: "Please pick a meeting." },
      ]);
    }
    calendarId = rawCalendarId;
    googleEventId = rawEventId;
  } else if (sourceType === "github_repo") {
    githubRepo = form.get("github_repo")?.toString() ?? "";
    if (!githubRepo) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        { type: "error", text: "Please pick a repository." },
      ]);
    }
  } else {
    textInput = form.get("text_input")?.toString().trim() ?? "";
    if (!textInput) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        { type: "error", text: "Please paste some text or notes." },
      ]);
    }
  }

  const topicHint = form.get("topic_hint")?.toString().trim() ?? "";
  const subjectName = form.get("subject_name")?.toString().trim() ?? "";
  // The form's subject-type field is hidden for a GitHub-repo source (the
  // picked repo already implies "tool") — default it here rather than
  // relying on a hidden input the browser might not send.
  const defaultSubjectType = sourceType === "github_repo" ? "tool" : "other";
  const subjectType = (form.get("subject_type")?.toString().trim() ||
    defaultSubjectType) as ReviewSubjectType;
  const intervieweeName = form.get("interviewee_name")?.toString().trim() ?? "";
  const author = form.get("author")?.toString().trim() || DEFAULT_AUTHOR;
  const articleDate = parseDateInputValue(form.get("date")?.toString()) ?? edition.periodStart;

  // Read the upload's bytes now, while the request is still alive: the `File`
  // handle belongs to this request and the `after()` callback below outlives it.
  const audioBytes = audioFile ? new Uint8Array(await audioFile.arrayBuffer()) : undefined;

  const editPath = `/admin/editions/${id}/edit`;
  const progressLabel = subjectName || githubRepo || `New ${generatorType} article`;

  const begun = await beginManualArticleGeneration(id, progressLabel);
  if (!begun.ok) {
    return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
      { type: "warning", text: begun.reason },
    ]);
  }

  after(async () => {
    await finishManualArticleGeneration(
      {
        editionId: id,
        sourceType: sourceType as SourceType,
        generatorType: generatorType as GeneratorType,
        aiModel,
        audioApiKey,
        audioFile: audioBytes,
        audioFilename,
        textInput,
        calendarId,
        googleEventId,
        githubRepo,
        topicHint,
        subjectName,
        subjectType,
        intervieweeName,
        articleDate,
        author,
      },
      // Per the plan's acceptance criteria, the admin should be able to tell
      // which path a calendar source used. That used to ride on this route's
      // success flash, which is now sent before the article exists — so it is
      // persisted as a generation message on the edition instead, which is
      // where the edit page already renders everything a finished background
      // run has to say.
      (article) => {
        if (sourceType !== "calendar_event") return [];
        const notesSource = readNotesSource(article.sourceData);
        if (notesSource === "gemini_notes_doc") {
          return [{ type: "info", text: "Used Gemini meeting notes as the source." }];
        }
        if (notesSource === "title_description_fallback") {
          return [
            {
              type: "info",
              text: "No meeting notes found — used the event's title, description, and attendees.",
            },
          ];
        }
        return [];
      },
    );
  });

  return flashRedirect(request, editPath, [
    { type: "info", text: "Generating the article — this page will update automatically." },
  ]);
}
