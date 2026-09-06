/**
 * Add a manual article — ported from `admin.article_add`
 * (`app/routes/admin.py:381-418`).
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextArticleOrder } from "@/lib/article-order";
import { editionMediaPrefix, saveMediaFile } from "@/lib/media-upload";
import { parseDateInputValue } from "@/lib/date-input";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  const form = await request.formData();
  const title = form.get("title")?.toString().trim() ?? "";
  const content = form.get("content")?.toString().trim() ?? "";
  if (!title || !content) {
    return flashRedirect(request, `/admin/editions/${id}/edit`, [
      { type: "error", text: "Title and content are required." },
    ]);
  }

  const prefix = editionMediaPrefix(edition);
  const articleDate = parseDateInputValue(form.get("date")?.toString()) ?? edition.periodStart;

  const imageFile = form.get("image");
  const audioFile = form.get("audio");

  await prisma.article.create({
    data: {
      editionId: id,
      title,
      content,
      category: form.get("category")?.toString() || "General",
      author: form.get("author")?.toString().trim() || "Staff Writer",
      deck: content.charAt(0) || "A",
      order: await nextArticleOrder(id),
      date: articleDate,
      image: imageFile instanceof File ? await saveMediaFile(imageFile, "image", prefix) : null,
      audio: audioFile instanceof File ? await saveMediaFile(audioFile, "audio", prefix) : null,
      video: form.get("video_url")?.toString().trim() || null,
      sourceType: "manual",
    },
  });

  return flashRedirect(request, `/admin/editions/${id}/edit`, [
    { type: "success", text: "Article added." },
  ]);
}
