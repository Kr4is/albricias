/**
 * POST half of the "Generate Activity Ranking" action on `.../articles/rank`.
 * Modelled on the sibling `.../articles/generate/run/route.ts`.
 */

import type { NextRequest } from "next/server";
import { describeError, flashRedirect } from "@/lib/flash";
import { prisma } from "@/lib/prisma";
import { createActivityRankingArticle } from "@/lib/rankings";

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const id = parseId(editionId);
  if (id === null) return new Response("Not found", { status: 404 });

  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  if (!process.env.OPENAI_API_KEY) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: "OPENAI_API_KEY is not configured." },
    ]);
  }

  try {
    const article = await createActivityRankingArticle(id);
    if (!article) {
      return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
        {
          type: "info",
          text: "No GitHub activity recorded for this edition — nothing to rank.",
        },
      ]);
    }
    return flashRedirect(request, `/admin/editions/${id}/articles/${article.id}/edit`, [
      { type: "success", text: "Activity ranking generated. Review and save your changes below." },
    ]);
  } catch (error) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: `Ranking failed: ${describeError(error)}` },
    ]);
  }
}
