/**
 * POST half of the assisted generation form at `.../articles/generate`
 * (`admin.article_generate` in `app/routes/admin.py:545-614`).
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateArticleFromSource, DEFAULT_AUTHOR } from "@/lib/generation";
import type { SourceType } from "@/lib/sources";
import type { GeneratorType, ReviewSubjectType } from "@/mastra/schemas";
import { parseDateInputValue } from "@/lib/date-input";
import { getSetting } from "@/lib/config/settings";
import { describeError, flashRedirect } from "@/lib/flash";

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

  const openaiKey = await getSetting("integrations.openai.apiKey", { encrypted: true });
  if (!openaiKey) {
    return flashRedirect(request, `/admin/editions/${id}/edit`, [
      { type: "error", text: "OpenAI API key is not configured — set it at /admin/settings." },
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
  let textInput = "";
  let calendarId: string | undefined;
  let googleEventId: string | undefined;

  if (sourceType.startsWith("audio_")) {
    const file = form.get("audio_file");
    if (!(file instanceof File) || file.size === 0) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        { type: "error", text: "Please upload an audio file." },
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
  const subjectType = (form.get("subject_type")?.toString().trim() || "other") as ReviewSubjectType;
  const intervieweeName = form.get("interviewee_name")?.toString().trim() ?? "";
  const author = form.get("author")?.toString().trim() || DEFAULT_AUTHOR;
  const articleDate = parseDateInputValue(form.get("date")?.toString()) ?? edition.periodStart;

  try {
    const article = await generateArticleFromSource({
      editionId: id,
      sourceType: sourceType as SourceType,
      generatorType: generatorType as GeneratorType,
      apiKey: openaiKey,
      audioFile,
      audioFilename,
      textInput,
      calendarId,
      googleEventId,
      topicHint,
      subjectName,
      subjectType,
      intervieweeName,
      articleDate,
      author,
    });

    let successText = "Article generated successfully. Review and save your changes below.";
    if (sourceType === "calendar_event") {
      // Per the plan's acceptance criteria, the admin should be able to tell
      // which path was used — surface it right in the success flash, in
      // addition to the indicator on the article edit page.
      const notesSource = readNotesSource(article.sourceData);
      if (notesSource === "gemini_notes_doc") {
        successText += " Used Gemini meeting notes as the source.";
      } else if (notesSource === "title_description_fallback") {
        successText += " No meeting notes found — used the event's title, description, and attendees.";
      }
    }

    return flashRedirect(request, `/admin/editions/${id}/articles/${article.id}/edit`, [
      { type: "success", text: successText },
    ]);
  } catch (error) {
    return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
      { type: "error", text: `Generation failed: ${describeError(error)}` },
    ]);
  }
}
