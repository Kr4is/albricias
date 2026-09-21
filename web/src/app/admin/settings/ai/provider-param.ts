/**
 * Shared by the three `/admin/settings/ai/[provider]/*` routes (save, test,
 * activate) — validates the dynamic `provider` segment against the same
 * `AiProviderId` union `@/lib/ai/provider` resolves against, and gives each
 * route a human label for its flash messages.
 */

import type { AiProviderId } from "@/lib/ai/provider";

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  litellm: "LiteLLM",
  openai: "OpenAI",
  ollama: "Ollama",
  gemini: "Gemini",
};

export function isAiProviderId(value: string): value is AiProviderId {
  return value in AI_PROVIDER_LABELS;
}
