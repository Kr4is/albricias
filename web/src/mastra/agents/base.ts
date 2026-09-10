/**
 * Shared plumbing for every newspaper agent.
 *
 * Ported from `app/services/generators/_base.py`:
 *   - `NEWSPAPER_PERSONA` — verbatim, it is the voice of the whole paper.
 *   - `call_openai`       — now `runNewspaperAgent`, which routes through a
 *                           Mastra Agent instead of the raw OpenAI SDK.
 *   - `parse_response`    — now `parseResponse`, character-for-character the
 *                           same H1-headline convention.
 */

import type { Agent } from "@mastra/core/agent";

/** Verbatim from `_base.py:NEWSPAPER_PERSONA`. Do not reword. */
export const NEWSPAPER_PERSONA =
  "You are the chief editor of ¡Albricias!, a whimsical vintage newspaper " +
  "published in the style of early 20th-century broadsheets. " +
  "Your writing is eloquent, slightly dramatic, and uses the grandiloquent " +
  "journalistic voice of a bygone era — yet the content is accurate and grounded " +
  "in the actual material provided. " +
  "Use markdown for formatting.";

/**
 * Mastra model-router id for the model the Flask app used.
 * The router resolves `openai/*` against `OPENAI_API_KEY`.
 */
export const MODEL_ID = "openai/gpt-4o-mini" as const;

/** The bare model name, recorded in every `GeneratorResult.sourceData.model`. */
export const MODEL_NAME = "gpt-4o-mini";

/** Defaults from `_base.py:call_openai`. */
export const DEFAULT_TEMPERATURE = 0.8;
export const DEFAULT_MAX_TOKENS = 800;

/**
 * A resolved Mastra model-router config — see `@/lib/ai/provider`'s
 * `resolveAiModel()`, which builds one of these from the `ai.provider`
 * setting and its per-provider credentials at `/admin/settings` (OpenAI,
 * Google Gemini, or a local Ollama server).
 */
export interface ResolvedAiModel {
  /** `"provider/model"`, e.g. `"openai/gpt-4o-mini"`, `"google/gemini-2.0-flash"`, `"ollama/llama3.1"`. */
  id: `${string}/${string}`;
  apiKey?: string;
  /** Base URL override — used for Ollama and other OpenAI-compatible custom endpoints. */
  url?: string;
}

export interface RunAgentOptions {
  /** The user-role prompt. */
  user: string;
  /**
   * Resolved provider/model. Defaults to the static `MODEL_ID` (OpenAI,
   * reading `OPENAI_API_KEY`) when omitted — callers should normally resolve
   * one via `@/lib/ai/provider`'s `resolveAiModel()` first.
   */
  aiModel?: ResolvedAiModel;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Run `agent` against `user` and return the raw response text.
 *
 * Equivalent to `_base.call_openai(system=<agent instructions>, user=...)`; the
 * system prompt lives on the agent definition rather than being passed in.
 */
export async function runNewspaperAgent(
  agent: Agent,
  {
    user,
    aiModel,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
  }: RunAgentOptions,
): Promise<string> {
  const result = await agent.generate(user, {
    model: aiModel ?? MODEL_ID,
    modelSettings: { temperature, maxOutputTokens: maxTokens },
  });
  return result.text ?? "";
}

/**
 * Extract a Markdown H1 headline and body from an LLM response.
 *
 * Ported from `_base.py:parse_response`, including its quirk that an empty H1
 * (`"# "`) falls through to `fallback` and keeps the whole response as body.
 */
export function parseResponse(
  raw: string,
  fallback: string,
): { title: string; content: string } {
  const lines = raw.trim().split("\n");
  let title = "";
  let bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const stripped = lines[i].trim();
    if (stripped.startsWith("# ")) {
      title = stripped.slice(2).trim();
      bodyLines = lines.slice(i + 1);
      break;
    }
  }

  if (!title) {
    title = fallback;
    bodyLines = lines;
  }

  const content = bodyLines.join("\n").trim() || raw.trim();
  return { title, content };
}
