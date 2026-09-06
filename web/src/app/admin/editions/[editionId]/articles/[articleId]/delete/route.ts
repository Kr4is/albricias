/** Ported from `admin.article_delete` (`app/routes/admin.py:467-479`). */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; articleId: string }> },
) {
  const { editionId, articleId } = await params;
  const eId = Number(editionId);
  const aId = Number(articleId);

  const article = await prisma.article.findUnique({ where: { id: aId } });
  if (!article || article.editionId !== eId) {
    return new Response("Not found", { status: 404 });
  }

  await prisma.article.delete({ where: { id: aId } });

  return flashRedirect(request, `/admin/editions/${eId}/edit`, [
    { type: "success", text: "Article deleted." },
  ]);
}
