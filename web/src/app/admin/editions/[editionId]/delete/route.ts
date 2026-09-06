/**
 * Ported from `admin.edition_delete` (`app/routes/admin.py:353-363`).
 * `Article` and `ServiceActivity` cascade on delete (`onDelete: Cascade` in
 * the Prisma schema), matching SQLAlchemy's relationship cascade.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  await prisma.edition.delete({ where: { id } });

  return flashRedirect(request, "/admin/editions", [
    { type: "success", text: `Edition '${edition.title}' deleted.` },
  ]);
}
