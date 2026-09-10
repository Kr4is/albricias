/**
 * POST half of the generic ranking builder form on `.../articles/rank`.
 *
 * The form's `field` input carries `"<model>:<field>"` (e.g.
 * `"serviceActivity:eventType"`) so a single `<select>` can offer every
 * rankable field without client-side JS to keep two dependent dropdowns
 * (data source, then field) in sync.
 */

import type { NextRequest } from "next/server";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { describeError, flashRedirect } from "@/lib/flash";
import { prisma } from "@/lib/prisma";
import { createGenericRankingArticle, findRankableField, type RankableModel } from "@/lib/rankings";

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

  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  const form = await request.formData();
  const [model, field] = (form.get("field")?.toString() ?? "").split(":");
  const topN = Number.parseInt(form.get("top_n")?.toString() ?? "", 10);
  const scopeEditionId = Number.parseInt(form.get("scope_edition_id")?.toString() ?? "", 10);

  if (!findRankableField(model ?? "", field ?? "")) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: "Please choose a valid field to rank by." },
    ]);
  }
  if (!Number.isInteger(topN) || topN < 1 || topN > 50) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: "Top N must be a whole number between 1 and 50." },
    ]);
  }
  if (!Number.isInteger(scopeEditionId)) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: "Please choose an edition to scope the ranking to." },
    ]);
  }

  try {
    const article = await createGenericRankingArticle({
      editionId: id,
      scopeEditionId,
      model: model as RankableModel,
      field,
      topN,
      aiModel,
    });
    return flashRedirect(request, `/admin/editions/${id}/articles/${article.id}/edit`, [
      { type: "success", text: "Ranking generated. Review and save your changes below." },
    ]);
  } catch (error) {
    return flashRedirect(request, `/admin/editions/${id}/articles/rank`, [
      { type: "error", text: `Ranking failed: ${describeError(error)}` },
    ]);
  }
}
