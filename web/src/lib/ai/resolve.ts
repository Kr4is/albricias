/**
 * Resolves the visitor's chosen LLM provider + BYO API key (from the
 * `/api/generate` request body) into an AI SDK `LanguageModel` — no
 * server-side storage: the key lives only for the duration of this request.
 *
 * `createOpenAI({baseURL})` also covers any OpenAI-compatible gateway
 * (LiteLLM, a self-hosted Ollama, etc.) under `litellm` — one resolver,
 * three listed providers.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type AiProviderId = "openai" | "gemini" | "litellm";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export interface BuildAiModelInput {
  llmProvider: AiProviderId;
  llmApiKey?: string;
  llmModel?: string;
  llmBaseUrl?: string;
}

export function buildAiModel(input: BuildAiModelInput): LanguageModel {
  switch (input.llmProvider) {
    case "openai":
      return createOpenAI({ apiKey: input.llmApiKey })(input.llmModel || DEFAULT_OPENAI_MODEL);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: input.llmApiKey })(input.llmModel || DEFAULT_GEMINI_MODEL);
    case "litellm":
      // `.chat()`: OpenAI-compatible gateways (LiteLLM, Ollama, vLLM…) speak
      // Chat Completions; the SDK's default for `openai(...)` is the newer
      // Responses API, which most of them don't implement.
      return createOpenAI({ apiKey: input.llmApiKey, baseURL: input.llmBaseUrl }).chat(input.llmModel!);
  }
}
