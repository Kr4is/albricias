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
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  if (!process.env.OPENAI_API_KEY) {
    return flashRedirect(request, `/admin/editions/${id}/edit`, [
      { type: "error", text: "OPENAI_API_KEY is not configured." },
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

  if (sourceType.startsWith("audio_")) {
    const file = form.get("audio_file");
    if (!(file instanceof File) || file.size === 0) {
      return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
        { type: "error", text: "Please upload an audio file." },
      ]);
    }
    audioFile = file;
    audioFilename = file.name;
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
      audioFile,
      audioFilename,
      textInput,
      topicHint,
      subjectName,
      subjectType,
      intervieweeName,
      articleDate,
      author,
    });
    return flashRedirect(request, `/admin/editions/${id}/articles/${article.id}/edit`, [
      { type: "success", text: "Article generated successfully. Review and save your changes below." },
    ]);
  } catch (error) {
    return flashRedirect(request, `/admin/editions/${id}/articles/generate`, [
      { type: "error", text: `Generation failed: ${describeError(error)}` },
    ]);
  }
}
