/**
 * The whole self-serve pipeline, one request: fetch a GitHub user's activity
 * for a period, write a front page about it, return it — as Server-Sent
 * Events. Each section streams live (token by token) as the model writes
 * it, both because generation is several sequential LLM calls that can run
 * for a minute or more (streaming keeps the connection visibly alive) and
 * so the client can show the text being written in place.
 *
 * Nothing is persisted — the LLM key travels only for the duration of this
 * call.
 */

import { z } from "zod";

import { dayBounds, defaultEditionVol, periodBoundsForDate } from "@/lib/cadence";
import { editionWeather, periodLabel as formatPeriodLabel, periodLabelShort } from "@/lib/edition-helpers";
import { buildAiModel } from "@/lib/ai/resolve";
import { describeAiError } from "@/lib/ai/error";
import { fetchGithubActivity } from "@/lib/sources/github";
import { pickLayoutForContent } from "@/lib/layout";
import { knownRepos, mostActiveRepo, repoImageUrl, resolveRepo } from "@/lib/repo-image";
import { buildOutline, researchPeriod, writeSection } from "@/lib/generation/period-post";
import { buildByTheNumbersArticle, buildStarsArticle } from "@/lib/generation/deterministic-articles";
import type { IssueArticle } from "@/components/issue/types";

const baseFields = {
  githubUsername: z.string().trim().min(1).max(100),
  period: z.enum(["daily", "weekly", "monthly"]),
};

const requestSchema = z.discriminatedUnion("llmProvider", [
  z.object({ ...baseFields, llmProvider: z.literal("openai"), llmApiKey: z.string().min(1), llmModel: z.string().optional() }),
  z.object({ ...baseFields, llmProvider: z.literal("gemini"), llmApiKey: z.string().min(1), llmModel: z.string().optional() }),
  z.object({ ...baseFields, llmProvider: z.literal("litellm"), llmApiKey: z.string().min(1), llmModel: z.string().min(1), llmBaseUrl: z.string().min(1) }),
]);

function periodBoundsFor(period: "daily" | "weekly" | "monthly") {
  if (period === "daily") {
    // "Today" is always near-empty this early in the day — yesterday has a full day of activity.
    return dayBounds(new Date(Date.now() - 24 * 60 * 60 * 1000));
  }
  return periodBoundsForDate(period, new Date());
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

  const model = buildAiModel(input);
  const periodLabel = formatPeriodLabel(edition);
  const coverRepo = mostActiveRepo(activity);
  const repos = knownRepos(activity);
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
      /** A whole, already-known article (the deterministic ones) — sent through the same three events a streamed section uses. */
      const sendWholeArticle = (article: IssueArticle) => {
        send("section-start", { index: article.id, heading: article.title, category: article.category, author: article.author, deck: article.deck });
        send("section-delta", { index: article.id, delta: article.content });
        send("section-end", { index: article.id });
      };

      send("meta", {
        vol: defaultEditionVol(edition),
        dateLabel: periodLabel,
        dateShortLabel: periodLabelShort(edition),
        weather: editionWeather(edition),
        coverImage: coverRepo ? repoImageUrl(coverRepo) : null,
        warnings,
      });

      try {
        send("status", { message: "Planning the front page…" });
        const sourceText = researchPeriod(activity);
        const outline = await buildOutline({ periodLabel, cadence: input.period, sourceText, model });

        // Computed now (cheap, pure) so the total article count is known
        // before picking a layout — only their *emission* waits until
        // after the prose sections (below), so the AI's own headline
        // stays the front page's lead.
        const starsArticle = buildStarsArticle(activity);
        const numbersArticle = buildByTheNumbersArticle(activity);
        const total = outline.sections.length + (starsArticle ? 1 : 0) + (numbersArticle ? 1 : 0);
        send("layout", { layout: pickLayoutForContent(total) });

        // Each repo's card appears at most once on the page — the cover
        // already shows the most active one, and two sections about the
        // same repo shouldn't repeat the same picture.
        const pictured = new Set<string>(coverRepo ? [coverRepo] : []);

        for (let index = 0; index < outline.sections.length; index += 1) {
          const section = outline.sections[index];
          const repo = resolveRepo(section.repo, repos);
          const imageUrl = repo && !pictured.has(repo) ? repoImageUrl(repo) : null;
          if (repo) pictured.add(repo);
          send("section-start", { index, heading: section.heading, category: "Dispatch", author: "The Albricias Correspondent", deck: section.brief, imageUrl });
          try {
            await writeSection(
              { heading: section.heading, brief: section.brief, lengthTier: section.lengthTier, premise: outline.premise, periodLabel, sourceText, model },
              (delta) => send("section-delta", { index, delta }),
            );
            send("section-end", { index });
          } catch (error) {
            console.error(`[period-post] section "${section.heading}" failed:`, error);
            send("section-end", { index, failed: true });
          }
        }

        // Sent after the prose sections, so the AI's own headline section
        // stays `articles[0]` (the front page's lead) — these two are
        // sidebar material, never the lead story.
        if (starsArticle) sendWholeArticle(starsArticle);
        if (numbersArticle) sendWholeArticle(numbersArticle);

        send("done", { title: outline.title });
      } catch (error) {
        console.error(`[period-post] generation failed for "${input.githubUsername}" (${input.period}):`, error);
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
