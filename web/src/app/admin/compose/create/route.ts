/**
 * POST half of the Editor's Desk form at `/admin/compose`
 * (`compose.compose_article` in `app/routes/compose.py`).
 *
 * The only place in the codebase that auto-creates an `Edition` from an
 * article's date when no target edition is picked — generalised from the
 * original's `year`/`month` lookup to the current cadence's period bounds
 * around the article's date (there is no month/year on the period model).
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { EDITION_STATUS_DRAFT } from "@/lib/edition-helpers";
import { defaultEditionTitle, defaultEditionVol, getCadence, periodBoundsForDate } from "@/lib/cadence";
import { nextArticleOrder } from "@/lib/article-order";
import { editionMediaPrefix, saveMediaFile } from "@/lib/media-upload";
import { parseDateInputValue } from "@/lib/date-input";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const title = form.get("title")?.toString().trim() ?? "";
  const content = form.get("content")?.toString().trim() ?? "";

  if (!title || !content) {
    return flashRedirect(request, "/admin/compose", [
      { type: "error", text: "Headline and Narrative are required!" },
    ]);
  }

  const category = form.get("category")?.toString() || "General";
  const author = form.get("author")?.toString().trim() || "Staff Writer";
  const videoUrl = form.get("video_url")?.toString().trim() ?? "";
  const articleDate = parseDateInputValue(form.get("date")?.toString()) ?? new Date();

  const editionIdRaw = form.get("edition_id")?.toString() ?? "";
  let targetEdition = null;
  if (editionIdRaw) {
    const parsedId = Number.parseInt(editionIdRaw, 10);
    if (Number.isInteger(parsedId)) {
      targetEdition = await prisma.edition.findUnique({ where: { id: parsedId } });
    }
  }

  if (!targetEdition) {
    const cadence = await getCadence();
    const period = periodBoundsForDate(cadence, articleDate);
    targetEdition = await prisma.edition.findUnique({
      where: { cadence_periodStart: { cadence, periodStart: period.periodStart } },
    });
    if (!targetEdition) {
      const shape = { cadence, ...period };
      targetEdition = await prisma.edition.create({
        data: {
          cadence,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          title: defaultEditionTitle(shape),
          vol: defaultEditionVol(shape),
          status: EDITION_STATUS_DRAFT,
        },
      });
    }
  }

  const prefix = editionMediaPrefix(targetEdition);
  const imageFile = form.get("image");
  const audioFile = form.get("audio");

  await prisma.article.create({
    data: {
      editionId: targetEdition.id,
      title,
      content,
      category,
      author,
      deck: content.charAt(0) || "A",
      order: await nextArticleOrder(targetEdition.id),
      date: articleDate,
      image: imageFile instanceof File ? await saveMediaFile(imageFile, "image", prefix) : null,
      audio: audioFile instanceof File ? await saveMediaFile(audioFile, "audio", prefix) : null,
      video: videoUrl || null,
      sourceType: "manual",
    },
  });

  return flashRedirect(request, `/admin/editions/${targetEdition.id}/edit`, [
    { type: "success", text: "Article saved to press successfully!" },
  ]);
}
