/**
 * Save one AI provider's own fields — the per-provider counterpart to the
 * old single `/admin/settings/ai` route (deleted along with the one-card,
 * one-picker AI section it served; `/setup` onboarding still uses that
 * shape, see `field-specs.ts`'s `AI_FIELDS` doc comment). Filters
 * `AI_FIELDS` down to this provider's own `providerGroup` and reuses the
 * exact same `saveFields()` every other category route calls — no new save
 * semantics, just a narrower field list per provider instead of one mixed
 * form.
 */

import type { NextRequest } from "next/server";
import { flashRedirect } from "@/lib/flash";
import { saveFields } from "../../save-fields";
import { AI_FIELDS } from "../../field-specs";
import { AI_PROVIDER_LABELS, isAiProviderId } from "../provider-param";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isAiProviderId(provider)) {
    return new Response("Not found", { status: 404 });
  }

  const fields = AI_FIELDS.filter((field) => field.providerGroup === provider);
  const form = await request.formData();
  await saveFields(form, fields);

  return flashRedirect(request, "/admin/settings", [
    { type: "success", text: `${AI_PROVIDER_LABELS[provider]} settings saved.` },
  ]);
}
