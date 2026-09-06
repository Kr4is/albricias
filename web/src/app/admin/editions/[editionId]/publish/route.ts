/** Ported from `admin.edition_publish` (`app/routes/admin.py:327-337`). */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { EDITION_STATUS_PUBLISHED } from "@/lib/edition-helpers";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  await prisma.edition.update({
    where: { id },
    data: { status: EDITION_STATUS_PUBLISHED, publishedAt: new Date() },
  });

  return flashRedirect(request, "/admin/editions", [
    { type: "success", text: `Edition '${edition.title}' is now published.` },
  ]);
}
