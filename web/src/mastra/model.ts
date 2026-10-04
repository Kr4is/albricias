/**
 * The secrets and settings a run carries in its request context, never
 * stored — gone once the run is:
 *
 *   MODEL_KEY          which model the agents run on
 *   CALL_OPTIONS_KEY   each call's provider options (the thinking choice)
 *   GITHUB_TOKEN_KEY   the token `gather`/`pictures` read GitHub with
 *
 * From the app, the model is the visitor's own: `/api/generate` builds it
 * from their provider + BYO key (`buildAiModel`). Their GitHub token, if
 * they gave one, travels alongside it — needed for their private activity,
 * optional (a higher rate limit) for a public edition, which otherwise reads
 * GitHub with the operator's `GITHUB_TOKEN`, or with none at all.
 *
 * From Mastra Studio (`npm run studio`), a run has no visitor, so the
 * agents fall back to a model configured in `.env` — `ALBRICIAS_LLM_*`,
 * the same four fields the app's form asks for (see `.env.example`) — or,
 * with none set, to `openai/gpt-4o-mini` on `OPENAI_API_KEY`; the GitHub
 * token falls back to the server's own `GITHUB_TOKEN`.
 */

import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import { buildAiModel, type AiProviderId, type ProviderOptions } from "@/lib/ai/resolve";

/** The request-context key a run's model travels under. */
export const MODEL_KEY = "model";

/** The request-context key for each call's provider options — how the visitor's thinking choice reaches the model. */
export const CALL_OPTIONS_KEY = "callOptions";

/** The request-context key for the run's GitHub token — the visitor's own, when they gave one. */
export const GITHUB_TOKEN_KEY = "githubToken";

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

/** The run's GitHub token: the visitor's own, or else the server's `GITHUB_TOKEN` (a Studio run's only option); none = unauthenticated. */
export function runGithubToken(requestContext: RequestContext): string | undefined {
  return (requestContext.get(GITHUB_TOKEN_KEY) as string | undefined) || process.env.GITHUB_TOKEN;
}
