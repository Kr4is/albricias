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
 * Nothing is persisted in production — the visitor's LLM key travels only
 * in this run's request context. (Locally, runs are also traced for Mastra
 * Studio; see `@/mastra`.)
 */

import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { buildAiModel, thinkingOff, THINKING_MODES } from "@/lib/ai/resolve";
import { describeAiError } from "@/lib/ai/error";
import { getMastra } from "@/mastra";
import { CALL_OPTIONS_KEY, MODEL_KEY, type CallOptions } from "@/mastra/model";

const baseFields = {
  githubUsername: z.string().trim().min(1).max(100),
  period: z.enum(["daily", "weekly", "monthly"]),
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
  if (!process.env.GITHUB_TOKEN) {
    return Response.json({ error: "Server is missing GITHUB_TOKEN." }, { status: 500 });
  }

  const requestContext = new RequestContext();
  requestContext.set(MODEL_KEY, buildAiModel(input));
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
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          closed = true;
        }
      };

      try {
        const output = run.stream({
          inputData: { githubUsername: input.githubUsername, period: input.period },
          requestContext,
          tracingOptions: { metadata: { githubUsername: input.githubUsername, period: input.period, thinking } },
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
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
