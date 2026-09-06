/**
 * Ported from `admin.edition_publish` (`app/routes/admin.py:327-337`).
 *
 * Phase D change: after publishing, redirect to the new post-publish
 * "distribute" review screen (`/admin/editions/[editionId]/distribute`)
 * instead of back to the dashboard — that screen shows AI-generated social
 * copy and a newsletter-send action, all opt-in (nothing sends
 * automatically just from landing there), so an admin who wants none of that
 * can simply navigate away with zero extra clicks required, same as before.
 */

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

  return flashRedirect(request, `/admin/editions/${id}/distribute`, [
    { type: "success", text: `Edition '${edition.title}' is now published.` },
  ]);
}
