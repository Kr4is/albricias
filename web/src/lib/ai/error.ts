/**
 * Turns an AI SDK call failure into a message worth showing a visitor.
 *
 * `APICallError.message` is frequently empty — the real detail lives in
 * `.statusCode`/`.responseBody` instead. And when the failure happens at a
 * reverse proxy in front of the actual provider/gateway (Cloudflare, most
 * commonly, for a self-hosted LiteLLM/Ollama setup) `.responseBody` is a
 * full HTML error page, not something to dump into a one-line error banner.
 */

import { APICallError } from "ai";

function isHtml(error: APICallError, body: string | undefined): boolean {
  const contentType = error.responseHeaders?.["content-type"] ?? "";
  return contentType.includes("text/html") || (body?.trimStart().startsWith("<") ?? false);
}

export function describeAiError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ? ` (HTTP ${error.statusCode})` : "";
    const body = error.responseBody?.trim();

    if (isHtml(error, body)) {
      const hint =
        error.statusCode === 524
          ? "the origin timed out — the model likely took longer to respond than your gateway/proxy allows"
          : error.statusCode && error.statusCode >= 500
            ? "the gateway returned an error page instead of a response — check it's reachable and healthy"
            : "the gateway returned an unexpected response";
      return `Request to the AI provider failed${status}: ${hint}.`;
    }

    return `${error.message || "Request to the AI provider failed"}${status}${body ? ` — ${body.slice(0, 300)}` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Settings we send that a model may refuse. */
export type RefusableSetting = "temperature" | "providerOptions";

/** Which of our settings a provider's error says it refused, if any — an unsupported `temperature`, an unknown `chat_template_kwargs`. */
export function refusedSetting(message: string): RefusableSetting | null {
  if (!/unsupported|not supported|does not support|doesn't support|unrecognized|unknown|not allowed|invalid|extra (inputs|fields)|not permitted/i.test(message)) return null;
  if (/temperature/i.test(message)) return "temperature";
  if (/chat_template_kwargs|enable_thinking/i.test(message)) return "providerOptions";
  return null;
}

