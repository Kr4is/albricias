/**
 * Resolves the visitor's chosen LLM provider + BYO API key (from the
 * `/api/generate` request body) into the Mastra model-router config the
 * agents consume — no server-side storage, no `Setting` lookup: the key
 * lives only for the duration of this one request.
 */

import type { ResolvedAiModel } from "@/mastra/agents/base";

export type AiProviderId = "openai" | "gemini" | "ollama" | "litellm";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

export interface BuildAiModelInput {
  llmProvider: AiProviderId;
  /** Not required for `ollama`, which needs no key. */
  llmApiKey?: string;
  llmModel?: string;
  llmBaseUrl?: string;
}

export function buildAiModel(input: BuildAiModelInput): ResolvedAiModel {
  switch (input.llmProvider) {
    case "openai":
      return { id: `openai/${input.llmModel || DEFAULT_OPENAI_MODEL}`, apiKey: input.llmApiKey };
    case "gemini":
      return { id: `google/${input.llmModel || DEFAULT_GEMINI_MODEL}`, apiKey: input.llmApiKey };
    case "ollama":
      return {
        id: `ollama/${input.llmModel}`,
        url: input.llmBaseUrl || DEFAULT_OLLAMA_BASE_URL,
        apiKey: "not-needed",
      };
    case "litellm":
      return { id: `litellm/${input.llmModel}`, url: input.llmBaseUrl, apiKey: input.llmApiKey };
  }
}
