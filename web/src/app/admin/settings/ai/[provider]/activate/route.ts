/**
 * Make one already-configured AI provider the active one — writes
 * `ai.provider` directly (the exact setting `resolveAiModel()` reads),
 * without touching any of that provider's own credential fields. Lets the
 * admin keep several providers configured and tested at once and switch
 * which one generation actually uses with one click, instead of the old
 * single form where picking a provider and saving its credentials were the
 * same action.
 */

import type { NextRequest } from "next/server";
import { setSetting } from "@/lib/config/settings";
import { flashRedirect } from "@/lib/flash";
import { AI_PROVIDER_LABELS, isAiProviderId } from "../../provider-param";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isAiProviderId(provider)) {
    return new Response("Not found", { status: 404 });
  }

  await setSetting("ai.provider", provider);

  return flashRedirect(request, "/admin/settings", [
    { type: "success", text: `${AI_PROVIDER_LABELS[provider]} is now the active provider.` },
  ]);
}
