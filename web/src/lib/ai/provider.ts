/**
 * Resolves which AI provider/model to use for Mastra text generation
 * (article drafting, rankings, social copy), based on the `ai.provider`
 * setting and its per-provider credentials at `/admin/settings` — same
 * "DB-stored, no `.env` fallback, takes effect immediately" contract as
 * every other integration (`@/lib/config/settings`). Returns `null` when the
 * selected provider isn't fully configured, so callers degrade gracefully
 * the same way they already do for every other optional source.
 *
 * Deliberately separate from audio (Whisper transcription, TTS narration),
 * which stays OpenAI-only regardless of the selected text provider — see
 * `requireOpenAiKeyForAudio` in `@/lib/generation` and `@/lib/tts`.
 */

import { getSetting } from "@/lib/config/settings";
import type { ResolvedAiModel } from "@/mastra/agents/base";

export type AiProviderId = "openai" | "gemini" | "ollama" | "litellm";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
/** Google renames/retires free-tier models over time — verify the current one in Google AI Studio. */
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

export const AI_PROVIDER_NOT_CONFIGURED_MESSAGE =
  "No AI provider is configured — set one at /admin/settings.";

async function resolveOpenAi(): Promise<ResolvedAiModel | null> {
  const [apiKey, model] = await Promise.all([
    getSetting("integrations.openai.apiKey", { encrypted: true }),
    getSetting("integrations.openai.model", { default: DEFAULT_OPENAI_MODEL }),
  ]);
  if (!apiKey) return null;
  return { id: `openai/${model || DEFAULT_OPENAI_MODEL}`, apiKey };
}

async function resolveGemini(): Promise<ResolvedAiModel | null> {
  const [apiKey, model] = await Promise.all([
    getSetting("integrations.gemini.apiKey", { encrypted: true }),
    getSetting("integrations.gemini.model", { default: DEFAULT_GEMINI_MODEL }),
  ]);
  if (!apiKey) return null;
  return { id: `google/${model || DEFAULT_GEMINI_MODEL}`, apiKey };
}

async function resolveOllama(): Promise<ResolvedAiModel | null> {
  const [baseUrl, model] = await Promise.all([
    getSetting("integrations.ollama.baseUrl", { default: DEFAULT_OLLAMA_BASE_URL }),
    getSetting("integrations.ollama.model"),
  ]);
  // No sensible default model — an unset value would silently try to run
  // whatever the user last had loaded (or nothing). Treat it the same as
  // "not configured" rather than guessing.
  if (!model) return null;
  return { id: `ollama/${model}`, url: baseUrl || DEFAULT_OLLAMA_BASE_URL, apiKey: "not-needed" };
}

/**
 * Any other OpenAI-compatible endpoint (e.g. a LiteLLM proxy in front of a
 * locally-hosted model). Unlike Ollama, there's no sensible default base URL
 * — it points at wherever that proxy actually runs — so both it and the
 * model are required, same as `resolveOllama()` treats its model.
 */
async function resolveLitellm(): Promise<ResolvedAiModel | null> {
  const [baseUrl, apiKey, model] = await Promise.all([
    getSetting("integrations.litellm.baseUrl"),
    getSetting("integrations.litellm.apiKey", { encrypted: true }),
    getSetting("integrations.litellm.model"),
  ]);
  if (!baseUrl || !apiKey || !model) return null;
  return { id: `litellm/${model}`, url: baseUrl, apiKey };
}

/**
 * The active provider's resolved Mastra model config, or `null` when it
 * isn't fully configured yet — matching this app's existing "skip this step
 * with a warning" convention for every other optional integration.
 */
export async function resolveAiModel(): Promise<ResolvedAiModel | null> {
  const provider = ((await getSetting("ai.provider", { default: "litellm" })) ??
    "litellm") as AiProviderId;
  switch (provider) {
    case "gemini":
      return resolveGemini();
    case "ollama":
      return resolveOllama();
    case "openai":
      return resolveOpenAi();
    case "litellm":
    default:
      return resolveLitellm();
  }
}
