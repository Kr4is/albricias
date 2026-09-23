/**
 * The whole self-serve pipeline, one request: fetch a GitHub user's activity
 * for a period, write a front page about it, return it — as Server-Sent
 * Events, since generation is several sequential LLM calls (concurrency 1,
 * see `period-post.ts`) that can run for a minute or more. Streaming keeps
 * the connection visibly alive instead of one long blocking request (a
 * failure mode this codebase has hit before — see the "generation can take
 * minutes" note in `@/mastra/agents/base`'s `runNewspaperAgent`), and lets
 * the client reveal each section as it's written rather than the whole page
 * at once.
 *
 * Nothing is persisted — the LLM key travels only for the duration of this
 * call.
 */

import { z } from "zod";

import { dayBounds, defaultEditionVol, periodBoundsForDate } from "@/lib/cadence";
import { editionWeather, periodLabel as formatPeriodLabel, periodLabelShort } from "@/lib/edition-helpers";
import { buildAiModel } from "@/lib/ai/resolve";
import { fetchGithubActivity } from "@/lib/sources/github";
import { randomLayoutIndex } from "@/lib/layout";
import { periodPostWorkflow } from "@/mastra/workflows/period-post";

const baseFields = {
  githubUsername: z.string().trim().min(1).max(100),
  period: z.enum(["daily", "weekly", "monthly"]),
};

const requestSchema = z.discriminatedUnion("llmProvider", [
  z.object({ ...baseFields, llmProvider: z.literal("openai"), llmApiKey: z.string().min(1), llmModel: z.string().optional() }),
  z.object({ ...baseFields, llmProvider: z.literal("gemini"), llmApiKey: z.string().min(1), llmModel: z.string().optional() }),
  z.object({ ...baseFields, llmProvider: z.literal("ollama"), llmApiKey: z.string().optional(), llmModel: z.string().min(1), llmBaseUrl: z.string().optional() }),
  z.object({ ...baseFields, llmProvider: z.literal("litellm"), llmApiKey: z.string().min(1), llmModel: z.string().min(1), llmBaseUrl: z.string().min(1) }),
]);

function periodBoundsFor(period: "daily" | "weekly" | "monthly") {
  if (period === "daily") {
    // "Today" is always near-empty this early in the day — yesterday has a full day of activity.
    return dayBounds(new Date(Date.now() - 24 * 60 * 60 * 1000));
  }
  return periodBoundsForDate(period, new Date());
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `period-post.ts` step ids → what to show on the generating screen. */
const STEP_STATUS_LABELS: Record<string, string> = {
  research: "Reading the activity…",
  "build-outline": "Planning the front page…",
  assemble: "Setting the final page…",
};

interface SectionIterationOutput {
  heading?: string;
  brief?: string;
  content?: string | null;
  ok?: boolean;
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request.", details: body.error.flatten() }, { status: 400 });
  }
  const input = body.data;

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return Response.json({ error: "Server is missing GITHUB_TOKEN." }, { status: 500 });
  }

  const { periodStart, periodEnd } = periodBoundsFor(input.period);
  const edition = { cadence: input.period, periodStart, periodEnd };

  const warnings: string[] = [];
  const activity = await fetchGithubActivity({
    username: input.githubUsername,
    token: githubToken,
    periodStart,
    periodEnd,
    onWarning: (message) => warnings.push(message),
  });
  if (activity.length === 0) {
    return Response.json(
      { error: `No public GitHub activity found for "${input.githubUsername}" in that period.` },
      { status: 404 },
    );
  }

  const aiModel = buildAiModel(input);
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

      send("meta", {
        vol: defaultEditionVol(edition),
        dateLabel: formatPeriodLabel(edition),
        dateShortLabel: periodLabelShort(edition),
        weather: editionWeather(edition),
        layout: randomLayoutIndex(),
        warnings,
      });

      try {
        const run = await periodPostWorkflow.createRun();
        const runStream = run.stream({
          inputData: {
            periodLabel: formatPeriodLabel(edition),
            cadence: input.period,
            activity: activity.map((item) => ({
              eventType: item.eventType,
              repo: item.repo,
              title: item.title,
              url: item.url,
              timestamp: item.timestamp,
            })),
            aiModel,
          },
        });

        for await (const chunk of runStream.fullStream) {
          if (chunk.type === "workflow-step-start") {
            const label = STEP_STATUS_LABELS[chunk.payload.id];
            if (label) send("status", { message: label });
          } else if (chunk.type === "workflow-step-progress" && chunk.payload.id === "write-section") {
            const output = chunk.payload.iterationOutput as SectionIterationOutput | undefined;
            if (output?.ok && output.content) {
              send("section", { index: chunk.payload.currentIndex, heading: output.heading, brief: output.brief, content: output.content });
            }
          }
        }

        const outcome = await runStream.result;
        if (outcome.status !== "success") {
          const message = outcome.status === "failed" ? describe(outcome.error) : `Generation did not complete (${outcome.status}).`;
          send("error", { error: message });
        } else {
          send("done", { title: outcome.result.title });
        }
      } catch (error) {
        send("error", { error: describe(error) });
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
