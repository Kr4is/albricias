/**
 * Calls Wave 1's `sendNewsletterForEdition()` (`@/lib/mail`) directly from
 * the distribute screen. This duplicates the standalone
 * `/admin/editions/[editionId]/newsletter/send` route Wave 1 built (kept
 * as-is, still linked from the edition edit page as a manual re-send
 * fallback) — both call the exact same function and produce identical
 * results, so there's no behavioral inconsistency between the two entry
 * points, just two places to trigger the same action.
 */

import type { NextRequest } from "next/server";
import { sendNewsletterForEdition } from "@/lib/mail";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = Number(editionId);
  const backTo = `/admin/editions/${editionId}/distribute`;

  try {
    const { sent, failed } = await sendNewsletterForEdition(id);
    return flashRedirect(request, backTo, [
      {
        type: failed > 0 && sent === 0 ? "warning" : "success",
        text: `Newsletter sent: ${sent} succeeded, ${failed} failed.`,
      },
    ]);
  } catch (error) {
    return flashRedirect(request, backTo, [
      { type: "error", text: `Sending the newsletter failed: ${describeError(error)}` },
    ]);
  }
}
