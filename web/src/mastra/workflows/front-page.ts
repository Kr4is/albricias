/**
 * The front page, as a Mastra workflow:
 *
 *   gather → plan → review → foreach(write-section, SECTION_CONCURRENCY) → assemble
 *
 *   gather         GitHub activity + repo details → the period's dossier
 *                  (typed JSON, `@/lib/generation/dossier`)
 *   plan           the outline editor's outline, as a typed object
 *                  (`outlineSchema`, Mastra structured output)
 *   review         the outline checked and fixed against the dossier, in
 *                  code (`reviewOutline`): real repo names, one reading
 *                  list, the lead, the section count, forgotten work
 *   write-section  one correspondent call per section, streamed token by
 *                  token, reading only its slice of the dossier
 *   assemble       the computed boxes (stars, numbers), and done
 *
 * Every step also narrates itself to the page through `writer`: each
 * `writer.write({ event, data })` becomes one `workflow-step-output` in the
 * run's stream, which `/api/generate` relays verbatim as a Server-Sent
 * Event (`event: <event>`) — so the page renders the edition live, section
 * by section, as the correspondent writes it. The events are the same the
 * page has always spoken: `meta`, `status`, `layout`, `section-start`,
 * `section-delta`, `section-end`, `done`.
 *
 * Sections are written `SECTION_CONCURRENCY` at a time (2 unless
 * `ALBRICIAS_SECTION_CONCURRENCY` says otherwise): one at a time a busy
 * week took minutes, but some self-hosted gateways drop connections under
 * concurrent load — set it to 1 for those. A section whose call fails
 * before writing anything is retried once. The page puts sections in
 * outline order however they finish.
 */

import type { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { describeAiError } from "@/lib/ai/error";
import { defaultEditionVol, editionBounds } from "@/lib/cadence";
import { editionWeather, periodLabel as formatPeriodLabel } from "@/lib/edition-helpers";
import { buildByTheNumbersArticle, buildStarsArticle, starImageCandidates } from "@/lib/generation/deterministic-articles";
import { buildDossier, dossierSchema, dossierText, sliceDossier } from "@/lib/generation/dossier";
import { outlineSchema, reviewOutline, SECTION_KINDS, type Outline, type SectionKind } from "@/lib/generation/outline";
import { buildOutlinePrompt, buildSectionPrompt, DEFAULT_TEMPERATURE, createLeadingHeadingFilter } from "@/lib/generation/period-post";
import { pickLayoutForContent } from "@/lib/layout";
import { repoImageUrl } from "@/lib/repo-image";
import { fetchGithubActivity, fetchRepoDetails } from "@/lib/sources/github";

/** How many sections are written at once — see the header. */
const SECTION_CONCURRENCY = Math.max(1, Math.floor(Number(process.env.ALBRICIAS_SECTION_CONCURRENCY) || 2));

// ---------------------------------------------------------------------------
// Schemas — what Studio shows as each step's input and output
// ---------------------------------------------------------------------------

const cadenceSchema = z.enum(["daily", "weekly", "monthly"]);
const lengthTierSchema = z.enum(["short", "medium", "long"]);

const articleSchema = z.object({
  id: z.number(),
  title: z.string(),
  content: z.string(),
  category: z.string(),
  author: z.string().nullable(),
  deck: z.string(),
  imageUrl: z.string().nullable().optional(),
});

const inputSchema = z.object({
  githubUsername: z.string().trim().min(1).max(100).describe("Whose public GitHub activity to report on"),
  period: cadenceSchema.describe("daily = yesterday; weekly/monthly = the current week/month"),
});

const gatheredSchema = z.object({
  periodLabel: z.string(),
  cadence: cadenceSchema,
  /** Everything the period recorded, typed — what the outline editor reads, and each section a slice of. */
  dossier: dossierSchema,
  numbersArticle: articleSchema.nullable(),
  starsArticle: articleSchema.nullable(),
  /** Starred repos by popularity — the stars box takes the first card no section used. */
  starCandidates: z.array(z.string()),
});

const plannedSchema = z.object({
  /** What the outline editor answered — `null` when it never came back as a valid outline. */
  outline: outlineSchema.nullable(),
});

const sectionBriefSchema = z.object({
  index: z.number(),
  heading: z.string(),
  brief: z.string(),
  kind: z.enum(SECTION_KINDS),
  lengthTier: lengthTierSchema,
  /** The repos the section covers — what it reads of the dossier (`sliceDossier`), the first its picture. */
  repos: z.array(z.string()),
  window: z.object({ from: z.string(), to: z.string() }).nullable(),
  imageUrl: z.string().nullable(),
  premise: z.string(),
  periodLabel: z.string(),
});

const reviewedSchema = z.object({
  title: z.string(),
  premise: z.string(),
  sections: z.array(sectionBriefSchema),
  /** Repos whose card a section already shows. */
  pictured: z.array(z.string()),
  /** A reading-list section covers the stars, so the stars box is left out. */
  dropStarsBox: z.boolean(),
  /** What the review changed in the editor's outline, and why. */
  notes: z.array(z.string()),
});

/** How the page labels each kind of section. */
const CATEGORY: Record<SectionKind, string> = {
  feature: "Feature",
  roundup: "Dispatches",
  overview: "The Period",
  "reading-list": "Reading List",
};

const sectionResultSchema = z.object({
  index: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
});

const outputSchema = z.object({
  title: z.string(),
  sectionsWritten: z.number(),
  sectionsFailed: z.number(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** What every step's `writer` carries: one page event, relayed as SSE `event: <event>`. */
interface PageEvent {
  event: string;
  data: unknown;
}

interface Writer {
  write(chunk: PageEvent): Promise<void>;
}

/** `writer` is typed optional on a step's context; it's always there inside a run. */
function page(writer: unknown): Writer {
  return (writer as Writer | undefined) ?? { write: async () => {} };
}

interface StreamedText<T = never> {
  text: string;
  finishReason: string;
  /** With `schema`: the reply validated against it, or `undefined` when it didn't parse or fit. */
  object?: T;
}

/**
 * One streamed agent call, each delta handed to `onDelta` as it arrives.
 * Streamed even when nobody watches (the outline): a blocking call sits
 * silent until the whole reply is ready, which trips a reverse proxy's
 * idle timeout in front of a slow self-hosted model; a stream keeps bytes
 * flowing from the first token.
 *
 * A Mastra agent doesn't throw on a provider error — the stream just ends
 * with `finishReason: "error"` and the cause in `error` — so that's turned
 * back into a thrown error here, worded for the visitor by
 * `describeAiError`. `maxRetries: 0` (Mastra's default, made explicit):
 * retries add seconds of backoff before a real failure (a bad key) surfaces.
 *
 * With a `schema`, the reply is Mastra structured output: the schema (its
 * field descriptions included) goes into the system prompt and the JSON
 * that comes back is parsed and validated against it — prompt injection
 * rather than the provider's native JSON mode, which not every
 * OpenAI-compatible gateway or model honours. A reply that doesn't fit
 * leaves `object` undefined (`errorStrategy: "warn"`) for the caller to
 * retry, instead of failing the run.
 */
async function streamAgent<T extends object = never>(
  agent: Agent,
  prompt: string,
  requestContext: RequestContext,
  options: { onDelta?: (delta: string) => Promise<void>; schema?: z.ZodType<T> } = {},
): Promise<StreamedText<T>> {
  const settings = { requestContext, modelSettings: { temperature: DEFAULT_TEMPERATURE, maxRetries: 0 } };
  const output = options.schema
    ? await agent.stream(prompt, { ...settings, structuredOutput: { schema: options.schema, jsonPromptInjection: true, errorStrategy: "warn" } })
    : await agent.stream(prompt, settings);
  for await (const delta of output.textStream) await options.onDelta?.(delta);
  const [text, finishReason] = await Promise.all([output.text, output.finishReason]);
  if (finishReason === "error") throw new Error(describeAiError(output.error));
  const object = options.schema ? ((await output.object.catch(() => undefined)) as T | undefined) : undefined;
  return { text: text ?? "", finishReason: finishReason ?? "unknown", object: object ?? undefined };
}

/** A reply too broken to use: cut off mid-generation, or nothing at all. */
function isUnusable(result: StreamedText<unknown>): boolean {
  return result.finishReason === "length" || !result.text.trim();
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const gather = createStep({
  id: "gather",
  description: "Fetch the period's GitHub activity and repo details, and lay them out as the writers' dossier.",
  inputSchema,
  outputSchema: gatheredSchema,
  execute: async ({ inputData, writer }) => {
    const out = page(writer);
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Server is missing GITHUB_TOKEN.");

    const { periodStart, periodEnd } = editionBounds(inputData.period);
    const edition = { cadence: inputData.period, periodStart, periodEnd };
    const periodLabel = formatPeriodLabel(edition);

    await out.write({ event: "status", data: { message: "Fetching the activity…" } });
    const warnings: string[] = [];
    const activity = await fetchGithubActivity({
      username: inputData.githubUsername,
      token,
      periodStart,
      periodEnd,
      onWarning: (message) => warnings.push(message),
    });
    if (activity.length === 0) {
      throw new Error(`No public GitHub activity found for "${inputData.githubUsername}" in that period.`);
    }

    await out.write({
      event: "meta",
      data: { vol: defaultEditionVol(edition), dateLabel: periodLabel, weather: editionWeather(edition), warnings },
    });

    await out.write({ event: "status", data: { message: "Reading up on the repositories…" } });
    const details = await fetchRepoDetails(activity, token);
    const dossier = buildDossier(activity, details, {
      username: inputData.githubUsername,
      periodLabel,
      cadence: inputData.period,
      periodStart,
      periodEnd,
    });

    return {
      periodLabel,
      cadence: inputData.period,
      dossier,
      numbersArticle: buildByTheNumbersArticle(activity),
      starsArticle: buildStarsArticle(activity, details),
      starCandidates: starImageCandidates(activity, details),
    };
  },
});

const plan = createStep({
  id: "plan",
  description: "Ask the outline editor for the page's outline — headline, premise, and each section's kind, brief, length and repos — as a typed object.",
  inputSchema: gatheredSchema,
  outputSchema: plannedSchema,
  execute: async ({ inputData, mastra, requestContext, writer }) => {
    const out = page(writer);
    await out.write({ event: "status", data: { message: "Planning the front page…" } });

    const editor = mastra.getAgent("outlineEditor");
    const prompt = buildOutlinePrompt({ periodLabel: inputData.periodLabel, cadence: inputData.cadence, sourceText: dossierText(inputData.dossier) });
    const ask = () => streamAgent<Outline>(editor, prompt, requestContext, { schema: outlineSchema });
    let reply = await ask();
    if (isUnusable(reply) || !reply.object) {
      console.warn(`[front-page] outline unusable (finishReason: ${reply.finishReason}, ${reply.object ? "parsed" : "no valid outline"}) — retrying once`);
      reply = await ask();
    }
    if (reply.finishReason === "length" && !reply.object) {
      throw new Error(
        "The outline came back truncated twice in a row. The provider may be enforcing its own token ceiling, or the model may be failing silently.",
      );
    }
    // Still nothing valid: `review` makes do with one section, rather than failing the edition.
    return { outline: reply.object ?? null };
  },
});

const review = createStep({
  id: "review",
  description: "Check the outline against the dossier and fix what a model gets wrong — repo names, kinds, the lead, the count, the stars — then pick each section's picture.",
  inputSchema: plannedSchema,
  outputSchema: reviewedSchema,
  execute: async ({ inputData, getStepResult, writer }) => {
    const gathered = getStepResult(gather);
    const reviewed = reviewOutline(inputData.outline, gathered.dossier, { cadence: gathered.cadence, periodLabel: gathered.periodLabel });
    for (const note of reviewed.notes) console.info(`[front-page] review: ${note}`);

    // Each repo's card appears at most once on the page.
    const pictured = new Set<string>();
    const sections = reviewed.sections.map((section, index) => {
      const repo = section.repos.find((name) => !pictured.has(name));
      if (repo) pictured.add(repo);
      return {
        ...section,
        index,
        imageUrl: repo && section.kind !== "overview" ? repoImageUrl(repo) : null,
        premise: reviewed.premise,
        periodLabel: gathered.periodLabel,
      };
    });

    const starsBox = gathered.starsArticle && !reviewed.dropStarsBox;
    const total = sections.length + (starsBox ? 1 : 0) + (gathered.numbersArticle ? 1 : 0);
    await page(writer).write({ event: "layout", data: { layout: pickLayoutForContent(total) } });
    return { title: reviewed.title, premise: reviewed.premise, sections, pictured: [...pictured], dropStarsBox: reviewed.dropStarsBox, notes: reviewed.notes };
  },
});

const writeSection = createStep({
  id: "write-section",
  description: "Have the correspondent write one section, streaming it to the page as it's written.",
  inputSchema: sectionBriefSchema,
  outputSchema: sectionResultSchema,
  execute: async ({ inputData, mastra, requestContext, writer, getStepResult }) => {
    const out = page(writer);
    const { index } = inputData;
    const focus = { kind: inputData.kind === "overview" || inputData.kind === "reading-list" ? inputData.kind : ("repos" as const), repos: inputData.repos, window: inputData.window };
    const sourceText = dossierText(sliceDossier(getStepResult(gather).dossier, focus));
    await out.write({
      event: "section-start",
      data: { index, heading: inputData.heading, category: CATEGORY[inputData.kind], author: "The Albricias Correspondent", deck: inputData.brief, imageUrl: inputData.imageUrl },
    });
    const attempt = async () => {
      const headings = createLeadingHeadingFilter();
      let sent = false;
      const send = async (delta: string) => {
        if (!delta) return;
        sent = true;
        await out.write({ event: "section-delta", data: { index, delta } });
      };
      try {
        const reply = await streamAgent(mastra.getAgent("correspondent"), buildSectionPrompt({ ...inputData, sourceText }), requestContext, {
          onDelta: (delta) => send(headings.push(delta)),
        });
        await send(headings.flush());
        return { reply, sent };
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { sent });
      }
    };

    try {
      let result;
      try {
        result = await attempt();
      } catch (error) {
        // A call that failed before writing a word (a gateway refusing or
        // dropping a connection under concurrent load, typically) is safe to
        // retry once — nothing of it is on the page yet. One that failed
        // midway isn't: the partial text is already showing.
        if ((error as { sent?: boolean }).sent) throw error;
        console.warn(`[front-page] section "${inputData.heading}" failed before any text — retrying once: ${(error as Error).message}`);
        result = await attempt();
      }
      // No retry on truncation either: by the time it's detected the text is
      // already on the page. The section is dropped instead.
      if (isUnusable(result.reply)) throw new Error(`truncated/empty (finishReason: ${result.reply.finishReason})`);
      await out.write({ event: "section-end", data: { index } });
      return { index, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[front-page] section "${inputData.heading}" failed: ${message}`);
      await out.write({ event: "section-end", data: { index, failed: true } });
      return { index, ok: false, error: message };
    }
  },
});

const assemble = createStep({
  id: "assemble",
  description: "Add the two computed boxes — starred repos and the numbers — after the written sections, and finish.",
  inputSchema: z.array(sectionResultSchema),
  outputSchema,
  execute: async ({ inputData, getStepResult, writer }) => {
    const out = page(writer);
    const gathered = getStepResult(gather);
    const planned = getStepResult(review);

    /** A computed article, sent through the same three events a written section uses. */
    const sendWhole = async (article: z.infer<typeof articleSchema>) => {
      await out.write({
        event: "section-start",
        data: { index: article.id, heading: article.title, category: article.category, author: article.author, deck: article.deck, imageUrl: article.imageUrl ?? null },
      });
      await out.write({ event: "section-delta", data: { index: article.id, delta: article.content } });
      await out.write({ event: "section-end", data: { index: article.id } });
    };

    // After the written sections, so the outline's own lead stays the lead.
    if (gathered.starsArticle && !planned.dropStarsBox) {
      const pictured = new Set(planned.pictured);
      const card = gathered.starCandidates.find((repo) => !pictured.has(repo));
      await sendWhole({ ...gathered.starsArticle, imageUrl: card ? repoImageUrl(card) : null });
    }
    if (gathered.numbersArticle) await sendWhole(gathered.numbersArticle);

    await out.write({ event: "done", data: { title: planned.title } });
    const failed = inputData.filter((result) => !result.ok).length;
    return { title: planned.title, sectionsWritten: inputData.length - failed, sectionsFailed: failed };
  },
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const frontPageWorkflow = createWorkflow({
  id: "front-page",
  description: "A GitHub user's activity over a period, written up as a vintage newspaper front page.",
  inputSchema,
  outputSchema,
  options: {
    // Locally every run is kept, for Studio. In production nothing is: the
    // app is stateless, and a server holding each visitor's run in memory
    // would only grow.
    shouldPersistSnapshot: () => process.env.NODE_ENV !== "production",
  },
})
  .then(gather)
  .then(plan)
  .then(review)
  .map(async ({ inputData }) => inputData.sections)
  .foreach(writeSection, { concurrency: SECTION_CONCURRENCY })
  .then(assemble)
  .commit();
