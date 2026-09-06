/**
 * Standalone admin-triggered "send newsletter for this edition" action.
 *
 * Deliberately NOT wired into the publish flow
 * (`web/src/app/admin/editions/[editionId]/publish/route.ts`) — per the
 * agent-editions-social-newsletter handoff, a later phase's post-publish
 * review screen calls `sendNewsletterForEdition` (`@/lib/mail`) directly
 * instead. This route exists so a send can be triggered manually in the
 * meantime, from the edition edit page.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendNewsletterForEdition } from "@/lib/mail";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  try {
    const { sent, failed } = await sendNewsletterForEdition(id);
    return flashRedirect(request, `/admin/editions/${id}/edit`, [
      {
        type: failed > 0 ? "warning" : "success",
        text: `Newsletter sent to ${sent} subscriber(s).${failed > 0 ? ` ${failed} failed.` : ""}`,
      },
    ]);
  } catch (error) {
    return flashRedirect(request, `/admin/editions/${id}/edit`, [
      { type: "warning", text: `Could not send the newsletter: ${describeError(error)}` },
    ]);
  }
}
