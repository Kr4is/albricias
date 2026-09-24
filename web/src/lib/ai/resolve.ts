/**
 * Resolves the visitor's chosen LLM provider + BYO API key (from the
 * `/api/generate` request body) into an AI SDK `LanguageModel` — no
 * server-side storage: the key lives only for the duration of this request.
 *
 * `createOpenAI({baseURL})` also covers Ollama and LiteLLM, both
 * OpenAI-compatible endpoints — one resolver, four providers.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

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

export function buildAiModel(input: BuildAiModelInput): LanguageModel {
  switch (input.llmProvider) {
    case "openai":
      return createOpenAI({ apiKey: input.llmApiKey })(input.llmModel || DEFAULT_OPENAI_MODEL);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: input.llmApiKey })(input.llmModel || DEFAULT_GEMINI_MODEL);
    case "ollama":
      return createOpenAI({ apiKey: "not-needed", baseURL: input.llmBaseUrl || DEFAULT_OLLAMA_BASE_URL })(input.llmModel!);
    case "litellm":
      return createOpenAI({ apiKey: input.llmApiKey, baseURL: input.llmBaseUrl })(input.llmModel!);
  }
}
