/**
 * Confirms a pending newsletter subscription via the emailed token link —
 * the second half of the double opt-in from `/newsletter/subscribe/create`.
 * No login required: the token itself is the credential, mirroring
 * `/newsletter/unsubscribe/[token]`.
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
  const subscriber = await prisma.subscriber.findUnique({ where: { confirmToken: token } });

  if (!subscriber) {
    return flashRedirect(request, REDIRECT_PATH, [
      { type: "error", text: "That confirmation link is invalid or has expired." },
    ]);
  }

  if (subscriber.status !== "confirmed") {
    await prisma.subscriber.update({
      where: { id: subscriber.id },
      data: { status: "confirmed", confirmedAt: new Date() },
    });
  }

  return flashRedirect(request, REDIRECT_PATH, [
    { type: "success", text: "Your subscription is confirmed. Welcome aboard!" },
  ]);
}
