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

/** Default from `_base.py:call_openai`. */
export const DEFAULT_TEMPERATURE = 0.8;

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

interface AgentGenerateResult {
  text?: string;
  finishReason?: string;
}

/** A response too broken to use: cut off mid-generation, or nothing at all. */
function isUnusable(result: AgentGenerateResult): boolean {
  return result.finishReason === "length" || !(result.text ?? "").trim();
}

/**
 * Run `agent` against `user` and return the raw response text.
 *
 * Equivalent to `_base.call_openai(system=<agent instructions>, user=...)`; the
 * system prompt lives on the agent definition rather than being passed in.
 *
 * No `maxOutputTokens` is sent unless a caller explicitly asks for one — the
 * provider picks its own ceiling instead. This app used to impose a fixed
 * 800-token cap by default, which is fine for a plain chat model but breaks a
 * "thinking"/reasoning model (Qwen3 and similar, common behind a self-hosted
 * LiteLLM proxy): it can spend the *entire* budget on `reasoning_content` and
 * stop at `finishReason: "length"` with `text` completely empty, or just as
 * unusably, cut off a few words into the headline. Verified against a real
 * Qwen3 deployment: the exact same "Open Source" prompt that returned nothing
 * at 800 tokens, and cut off mid-headline again at 4096, completed cleanly
 * with no cap at all — `finishReason: "stop"`, ~2900 completion tokens
 * (~10k characters of reasoning ahead of the actual ~2.4k-character article).
 * A fixed retry budget just guesses at a number that's already wrong for the
 * next heavier prompt; not capping avoids the guess entirely.
 *
 * Still retries once on a truncated/empty response — see {@link isUnusable}
 * — for the cases a cap doesn't explain: a transient network hiccup, or a
 * provider that enforces its own ceiling regardless of what we ask for. Every
 * caller already treats a thrown error here as "this piece failed" without
 * sinking the rest of the run (chronicle sections settle independently,
 * ranking generators warn and skip that ranking) — see the
 * edition-generation-reliability-and-concurrency plan's follow-up — so
 * throwing after the retry is still unusable is the correct "make the
 * failure visible instead of persisting a blank or truncated article"
 * behavior, not a new failure mode callers need to handle specially.
 */
export async function runNewspaperAgent(
  agent: Agent,
  { user, aiModel, temperature = DEFAULT_TEMPERATURE, maxTokens }: RunAgentOptions,
): Promise<string> {
  const modelSettings = { temperature, ...(maxTokens ? { maxOutputTokens: maxTokens } : {}) };
  const result = await agent.generate(user, { model: aiModel ?? MODEL_ID, modelSettings });
  if (!isUnusable(result)) return result.text ?? "";

  console.warn(
    `[runNewspaperAgent] truncated/empty response (finishReason: ${result.finishReason}, ` +
      `maxTokens: ${maxTokens ?? "unset"}) — retrying once`,
  );
  const retry = await agent.generate(user, { model: aiModel ?? MODEL_ID, modelSettings });
  if (!isUnusable(retry)) return retry.text ?? "";

  throw new Error(
    `AI generation returned a truncated/empty response twice in a row ` +
      `(finishReason: ${result.finishReason}, then ${retry.finishReason}). The provider may be ` +
      `enforcing its own token ceiling, or may be failing silently.`,
  );
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
