/**
 * Resolves the visitor's chosen LLM provider + BYO API key (from the
 * `/api/generate` request body) into an AI SDK `LanguageModel` — no
 * server-side storage: the key lives only for the duration of this request.
 *
 * `litellm` covers any OpenAI-compatible gateway (LiteLLM, a self-hosted
 * Ollama, vLLM…) through `@ai-sdk/openai-compatible`, which — unlike the
 * OpenAI provider pointed at another URL — reads the `reasoning_content` a
 * thinking model streams back, so its reasoning shows in Mastra's traces
 * instead of vanishing, and passes provider options straight into the
 * request body (how `thinkingOff` reaches the model).
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { JSONValue, LanguageModel } from "ai";

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
      // Chat Completions — what every OpenAI-compatible gateway speaks.
      return createOpenAICompatible({ name: GATEWAY, apiKey: input.llmApiKey, baseURL: input.llmBaseUrl!, includeUsage: true })(input.llmModel!);
  }
}

/** The gateway provider's name — also the key its per-call options go under. */
const GATEWAY = "gateway";

/** Where the model may think before answering: every call, only while planning the outline, or never. */
export type ThinkingMode = "full" | "outline" | "off";
export const THINKING_MODES: readonly ThinkingMode[] = ["full", "outline", "off"];

/** Per-call provider options, as the AI SDK and Mastra take them. */
export type ProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * The per-call options that stop a thinking model from thinking, or
 * `undefined` where there's no switch to send. Only the gateway has one:
 * `chat_template_kwargs.enable_thinking: false` is how Qwen-style models
 * served by vLLM or SGLang (directly or behind LiteLLM) skip their
 * reasoning — most of a thinking model's output tokens, and most of its
 * time. A model without the switch just ignores it.
 */
export function thinkingOff(provider: AiProviderId): ProviderOptions | undefined {
  return provider === "litellm" ? { [GATEWAY]: { chat_template_kwargs: { enable_thinking: false } } } : undefined;
}
