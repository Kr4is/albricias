/**
 * Generate a TTS audio rendition of a single article — sibling to
 * `.../regenerate/route.ts`, same shape: verify the article belongs to the
 * edition, check the required API key up front, run the operation inside a
 * try/catch that flashes success or failure, and redirect back to the
 * article edit page either way.
 *
 * Deviation from `regenerate/route.ts`: that route's missing-API-key
 * pre-check redirects to the *edition* edit page
 * (`/admin/editions/${eId}/edit`) while its try/catch outcome redirects to
 * the *article* edit page — an inconsistency in the original. Since the
 * "Generate audio" button lives on the article edit page, both branches here
 * redirect back to the article edit page for a consistent result.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateArticleAudio } from "@/lib/tts";
import { getSetting } from "@/lib/config/settings";
import { describeError, flashRedirect, type FlashMessage } from "@/lib/flash";

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

  const editPath = `/admin/editions/${eId}/articles/${aId}/edit`;

  const openaiKey = await getSetting("integrations.openai.apiKey", { encrypted: true });
  if (!openaiKey) {
    return flashRedirect(request, editPath, [
      { type: "error", text: "OpenAI API key is not configured — set it at /admin/settings." },
    ]);
  }

  let message: FlashMessage;
  try {
    await generateArticleAudio(aId, openaiKey);
    message = { type: "success", text: "Audio generated for article." };
  } catch (error) {
    message = { type: "error", text: `Audio generation failed: ${describeError(error)}` };
  }

  return flashRedirect(request, editPath, [message]);
}
