/**
 * POST half of the edition metadata form at `.../edit`
 * (`admin.edition_edit` in `app/routes/admin.py:243-270`).
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { editionMediaPrefix, saveMediaFile } from "@/lib/media-upload";
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
  const title = form.get("title")?.toString().trim() || edition.title;
  const vol = form.get("vol")?.toString().trim() || edition.vol;

  const prefix = `${editionMediaPrefix(edition)}-cover`;
  let coverImage = edition.coverImage;
  const coverFile = form.get("cover_image");
  if (coverFile instanceof File && coverFile.size > 0) {
    const saved = await saveMediaFile(coverFile, "image", prefix);
    if (saved) coverImage = saved;
  } else {
    const coverUrl = form.get("cover_image_url")?.toString().trim();
    if (coverUrl) coverImage = coverUrl;
  }

  await prisma.edition.update({ where: { id }, data: { title, vol, coverImage } });

  return flashRedirect(request, `/admin/editions/${id}/edit`, [
    { type: "success", text: "Edition metadata updated." },
  ]);
}
