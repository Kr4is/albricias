/**
 * "Test connection" for one specific AI provider — the per-provider
 * counterpart to the old single `/admin/settings/ai/test` route (deleted:
 * testing only ever made sense per-provider once several can be configured
 * at once, see `SettingsPanel.tsx`'s AI Generation section). Same real call
 * as before (`connectionTestAgent` via `runNewspaperAgent`), just resolved
 * against *this* provider (`resolveAiModelFor`) regardless of which one is
 * currently active.
 */

import type { NextRequest } from "next/server";
import { resolveAiModelFor } from "@/lib/ai/provider";
import { connectionTestAgent, runNewspaperAgent } from "@/mastra/agents";
import { describeError, flashRedirect } from "@/lib/flash";
import { AI_PROVIDER_LABELS, isAiProviderId } from "../../provider-param";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isAiProviderId(provider)) {
    return new Response("Not found", { status: 404 });
  }
  const label = AI_PROVIDER_LABELS[provider];

  const aiModel = await resolveAiModelFor(provider);
  if (!aiModel) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: `${label} is not fully configured yet.` },
    ]);
  }

  try {
    await runNewspaperAgent(connectionTestAgent, { user: "Reply with the single word OK.", aiModel });
    return flashRedirect(request, "/admin/settings", [
      { type: "success", text: `${label} responded (${aiModel.id}).` },
    ]);
  } catch (error) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: `${label} connection test failed: ${describeError(error)}` },
    ]);
  }
}
