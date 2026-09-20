/**
 * "Test connection" for the AI settings category — sends a trivial prompt
 * through the currently configured provider/model via the exact same
 * `runNewspaperAgent` call path real generation uses (see
 * `connectionTestAgent` in `@/mastra/agents`), so a pass here means real
 * generation would actually reach the provider. Exists because "saved" and
 * "works" are different things — a self-signed cert or an expired key look
 * identical to `resolveAiModel()`'s presence check and only surface once a
 * full edition generation fails.
 */

import type { NextRequest } from "next/server";
import { AI_PROVIDER_NOT_CONFIGURED_MESSAGE, resolveAiModel } from "@/lib/ai/provider";
import { connectionTestAgent, runNewspaperAgent } from "@/mastra/agents";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const aiModel = await resolveAiModel();
  if (!aiModel) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: AI_PROVIDER_NOT_CONFIGURED_MESSAGE },
    ]);
  }

  try {
    await runNewspaperAgent(connectionTestAgent, { user: "Reply with the single word OK.", aiModel });
    return flashRedirect(request, "/admin/settings", [
      { type: "success", text: `AI provider responded (${aiModel.id}).` },
    ]);
  } catch (error) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: `AI connection test failed: ${describeError(error)}` },
    ]);
  }
}
