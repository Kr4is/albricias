/**
 * The whole self-serve pipeline, one request: run the `front-page` Mastra
 * workflow (`@/mastra/workflows/front-page`) for a GitHub user and period,
 * and relay it to the page as Server-Sent Events. Each section streams
 * live, token by token, as the correspondent writes it — generation is
 * several sequential model calls that can run for minutes, and the page
 * shows the text being written in place.
 *
 * The workflow's steps narrate themselves as `{ event, data }` chunks
 * (`workflow-step-output` in the run's stream); this route forwards each
 * as one SSE `event: <event>` unchanged, and turns a failed run into an
 * `error` event.
 *
 * Nothing is persisted in production — the visitor's LLM key (and their
 * GitHub token, if they supplied one) travel only in this run's request
 * context. (Locally, runs are also traced for Mastra Studio; see
 * `@/mastra`.)
 */

import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { CADENCES } from "@/lib/periods";
import { buildAiModel, thinkingOff, THINKING_MODES } from "@/lib/ai/resolve";
import { describeAiError } from "@/lib/ai/error";
import { getMastra } from "@/mastra";
import { CALL_OPTIONS_KEY, GITHUB_TOKEN_KEY, MODEL_KEY, type CallOptions } from "@/mastra/model";

const baseFields = {
  githubUsername: z.string().trim().min(1).max(100),
  period: z.enum(CADENCES),
  /**
   * Off (the default): only the user's public activity is read, with the
   * server's own `GITHUB_TOKEN` when it has one, else unauthenticated — the
   * visitor supplies nothing. On: the visitor's own `githubToken` (with
   * access to their private repositories) reads everything it can see.
   */
  includePrivate: z.boolean().default(false),
  githubToken: z.string().trim().min(1).optional(),
};

const requestSchema = z.discriminatedUnion("llmProvider", [
  z.object({ ...baseFields, llmProvider: z.literal("openai"), llmApiKey: z.string().min(1), llmModel: z.string().optional() }),
  z.object({ ...baseFields, llmProvider: z.literal("gemini"), llmApiKey: z.string().min(1), llmModel: z.string().optional() }),
  z.object({
    ...baseFields,
    llmProvider: z.literal("litellm"),
    llmApiKey: z.string().min(1),
    llmModel: z.string().min(1),
    llmBaseUrl: z.string().min(1),
    thinking: z.enum(THINKING_MODES).default("full"),
  }),
]);

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/** A comment line every so often, so the page (and any proxy) can tell a quiet run from a dead connection. */
const HEARTBEAT_MS = 15_000;
/** No page event for this long and the run is stopped with an error — longer than a model call may stay silent (`MODEL_IDLE_MS`). */
const RUN_IDLE_MS = 6 * 60_000;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A step's `writer.write({ event, data })`, as it comes out of the run's stream. */
function pageEvent(chunk: { type: string; payload?: unknown }): { event: string; data: unknown } | null {
  if (chunk.type !== "workflow-step-output") return null;
  const output = (chunk.payload as { output?: unknown } | undefined)?.output;
  if (!output || typeof output !== "object" || typeof (output as { event?: unknown }).event !== "string") return null;
  return output as { event: string; data: unknown };
}

/**
 * A failed run's error, for the visitor. Mastra hands it back serialized —
 * `{ message, name, … }`, not an `Error` — and the step already worded the
 * message (`describeAiError`), so it's used as is.
 */
function runErrorMessage(error: unknown): string {
  if (error instanceof Error) return describeAiError(error);
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return typeof error === "string" && error ? error : "Generation failed.";
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request.", details: body.error.flatten() }, { status: 400 });
  }
  const input = body.data;
  if (input.includePrivate && !input.githubToken) {
    return Response.json({ error: "Including private activity needs a GitHub token of your own." }, { status: 400 });
  }

  const requestContext = new RequestContext();
  requestContext.set(MODEL_KEY, buildAiModel(input));
  // Public runs carry no visitor token: `runGithubToken` falls back to the server's.
  if (input.includePrivate) requestContext.set(GITHUB_TOKEN_KEY, input.githubToken);
  const thinking = "thinking" in input ? input.thinking : "full";
  const off = thinkingOff(input.llmProvider);
  const callOptions: CallOptions = { outline: thinking === "off" ? off : undefined, sections: thinking === "full" ? undefined : off };
  requestContext.set(CALL_OPTIONS_KEY, callOptions);

  const mastra = await getMastra();
  const run = await mastra.getWorkflow("frontPage").createRun();
  // A visitor who leaves mid-edition shouldn't keep spending their tokens.
  // (Also fires once a finished run's connection closes — harmless then.)
  request.signal.addEventListener("abort", () => {
    run.cancel().catch(() => {});
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastEvent = Date.now();
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => {
        lastEvent = Date.now();
        write(sseEvent(event, data));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const watchdog = setInterval(() => {
        if (Date.now() - lastEvent < RUN_IDLE_MS) return write(": ping\n\n");
        console.error(`[front-page] run for "${input.githubUsername}" stalled — no progress for ${RUN_IDLE_MS / 1000}s, cancelling`);
        send("error", { error: "Generation stalled — nothing happened for several minutes, so it was stopped. Try again, or check your AI provider." });
        run.cancel().catch(() => {});
        finish();
      }, HEARTBEAT_MS);

      try {
        const output = run.stream({
          inputData: { githubUsername: input.githubUsername, period: input.period, includePrivate: input.includePrivate },
          requestContext,
          tracingOptions: { metadata: { githubUsername: input.githubUsername, period: input.period, includePrivate: input.includePrivate, thinking } },
        });
        for await (const chunk of output.fullStream) {
          const event = pageEvent(chunk);
          if (event) send(event.event, event.data);
        }
        const result = await output.result;
        if (result.status === "failed") {
          const error = (result as { error?: unknown }).error;
          console.error(`[front-page] run failed for "${input.githubUsername}" (${input.period}):`, error);
          send("error", { error: runErrorMessage(error) });
        } else if (result.status !== "success") {
          send("error", { error: `Generation stopped (${result.status}).` });
        }
      } catch (error) {
        console.error(`[front-page] run crashed for "${input.githubUsername}" (${input.period}):`, error);
        send("error", { error: describeAiError(error) });
      } finally {
        clearInterval(watchdog);
        finish();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
