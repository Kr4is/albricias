/**
 * Unsubscribes via the token link present in every newsletter email
 * (`sendNewsletterForEdition`, `@/lib/mail`). No login required — the token
 * itself is the credential, mirroring `/newsletter/confirm/[token]`.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { flashRedirect } from "@/lib/flash";

const REDIRECT_PATH = "/newsletter/subscribe";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const subscriber = await prisma.subscriber.findUnique({ where: { unsubscribeToken: token } });

  if (!subscriber) {
    return flashRedirect(request, REDIRECT_PATH, [
      { type: "error", text: "That unsubscribe link is invalid." },
    ]);
  }

  if (subscriber.status !== "unsubscribed") {
    await prisma.subscriber.update({
      where: { id: subscriber.id },
      data: { status: "unsubscribed", unsubscribedAt: new Date() },
    });
  }

  return flashRedirect(request, REDIRECT_PATH, [
    { type: "info", text: "You have been unsubscribed. Sorry to see you go." },
  ]);
}
