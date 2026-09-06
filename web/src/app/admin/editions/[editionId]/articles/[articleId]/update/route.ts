/**
 * POST half of the article edit form at `.../edit`
 * (`admin.article_edit` in `app/routes/admin.py:421-464`).
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { editionMediaPrefix, saveMediaFile } from "@/lib/media-upload";
import { parseDateInputValue } from "@/lib/date-input";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; articleId: string }> },
) {
  const { editionId, articleId } = await params;
  const eId = Number(editionId);
  const aId = Number(articleId);

  const [edition, article] = await Promise.all([
    prisma.edition.findUnique({ where: { id: eId } }),
    prisma.article.findUnique({ where: { id: aId } }),
  ]);
  if (!edition || !article || article.editionId !== eId) {
    return new Response("Not found", { status: 404 });
  }

  const form = await request.formData();
  const title = form.get("title")?.toString().trim() || article.title;
  const content = form.get("content")?.toString() ?? article.content;
  const category = form.get("category")?.toString() || article.category;
  const author = form.get("author")?.toString().trim() || article.author;
  const deck = form.get("deck")?.toString().trim().slice(0, 1) || article.deck;

  const orderRaw = form.get("order")?.toString();
  const orderParsed = orderRaw !== undefined ? Number.parseInt(orderRaw, 10) : NaN;
  const order = Number.isInteger(orderParsed) ? orderParsed : article.order;

  const video = form.get("video_url")?.toString().trim() || null;
  const date = parseDateInputValue(form.get("date")?.toString()) ?? article.date;

  const prefix = editionMediaPrefix(edition);
  const imageFile = form.get("image");
  const audioFile = form.get("audio");
  const newImage =
    imageFile instanceof File && imageFile.size > 0
      ? await saveMediaFile(imageFile, "image", prefix)
      : null;
  const newAudio =
    audioFile instanceof File && audioFile.size > 0
      ? await saveMediaFile(audioFile, "audio", prefix)
      : null;

  await prisma.article.update({
    where: { id: aId },
    data: {
      title,
      content,
      category,
      author,
      deck,
      order,
      video,
      date,
      ...(newImage ? { image: newImage } : {}),
      ...(newAudio ? { audio: newAudio } : {}),
    },
  });

  return flashRedirect(request, `/admin/editions/${eId}/edit`, [
    { type: "success", text: "Article updated." },
  ]);
}
