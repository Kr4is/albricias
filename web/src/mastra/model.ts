/**
 * Which model the agents run on.
 *
 * From the app, always the visitor's own: `/api/generate` builds it from
 * their provider + BYO key (`buildAiModel`) and hands it to the run under
 * `MODEL_KEY` in the request context — never stored, gone when the run is.
 *
 * From Mastra Studio (`npm run studio`), a run has no visitor, so the
 * agents fall back to a model configured in `.env` — `ALBRICIAS_LLM_*`,
 * the same four fields the app's form asks for (see `.env.example`) — or,
 * with none set, to `openai/gpt-4o-mini` on `OPENAI_API_KEY`.
 */

import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import { buildAiModel, type AiProviderId, type ProviderOptions } from "@/lib/ai/resolve";

/** The request-context key a run's model travels under. */
export const MODEL_KEY = "model";

/** The request-context key for each call's provider options — how the visitor's thinking choice reaches the model. */
export const CALL_OPTIONS_KEY = "callOptions";

/** Provider options per kind of call; absent = the model's own default. */
export interface CallOptions {
  outline?: ProviderOptions;
  sections?: ProviderOptions;
}

/**
 * `buildAiModel`'s AI SDK model, as Mastra types it. `ai`'s `LanguageModel`
 * also admits a bare gateway id string, which Mastra reads differently;
 * `buildAiModel` only ever returns provider model objects (spec v4), which
 * Mastra runs as they are.
 */
function asMastraModel(model: ReturnType<typeof buildAiModel>): MastraModelConfig {
  return model as unknown as MastraModelConfig;
}

function studioModel(): MastraModelConfig {
  const provider = process.env.ALBRICIAS_LLM_PROVIDER as AiProviderId | undefined;
  const apiKey = process.env.ALBRICIAS_LLM_API_KEY;
  // Unconfigured: Mastra's own router id, which reads OPENAI_API_KEY. Not a
  // throw — Studio resolves every agent's model just to list them, and a
  // run without a key fails on its own, with the provider's message.
  if (!provider || !apiKey) return "openai/gpt-4o-mini";
  return asMastraModel(
    buildAiModel({
      llmProvider: provider,
      llmApiKey: apiKey,
      llmModel: process.env.ALBRICIAS_LLM_MODEL,
      llmBaseUrl: process.env.ALBRICIAS_LLM_BASE_URL,
    }),
  );
}

/** An agent's `model` resolver: the run's own model, or Studio's fallback. */
export function runModel({ requestContext }: { requestContext: RequestContext }): MastraModelConfig {
  const model = requestContext.get(MODEL_KEY) as ReturnType<typeof buildAiModel> | undefined;
  return model ? asMastraModel(model) : studioModel();
}
