/**
 * The front page, as a Mastra workflow:
 *
 *   gather → plan → foreach(write-section, SECTION_CONCURRENCY) → assemble
 *
 *   gather         GitHub activity + repo details → the period's dossier
 *   plan           the outline editor's headline, premise and briefs; each
 *                  brief's REPO checked against the repos really touched
 *   write-section  one correspondent call per brief, streamed token by token
 *   assemble       the two computed boxes (stars, numbers), and done
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
import {
  buildOutlinePrompt,
  buildSectionPrompt,
  DEFAULT_TEMPERATURE,
  createLeadingHeadingFilter,
  parseOutline,
} from "@/lib/generation/period-post";
import { researchPeriod } from "@/lib/generation/research";
import { pickLayoutForContent } from "@/lib/layout";
import { repoImageUrl, resolveRepo } from "@/lib/repo-image";
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
  /** The whole dossier — what the outline editor reads. */
  dossier: z.string(),
  /** Per repo (canonical `owner/name`), the dossier narrowed to it — what a section about that repo reads. */
  repoDossiers: z.record(z.string(), z.string()),
  /** Every repo the period touched — the only names a REPO line may resolve to. */
  knownRepos: z.array(z.string()),
  numbersArticle: articleSchema.nullable(),
  starsArticle: articleSchema.nullable(),
  /** Starred repos by popularity — the stars box takes the first card no section used. */
  starCandidates: z.array(z.string()),
});

const sectionBriefSchema = z.object({
  index: z.number(),
  heading: z.string(),
  brief: z.string(),
  lengthTier: lengthTierSchema,
  repo: z.string().nullable(),
  imageUrl: z.string().nullable(),
  premise: z.string(),
  periodLabel: z.string(),
  sourceText: z.string(),
});

const planSchema = z.object({
  title: z.string(),
  premise: z.string(),
  sections: z.array(sectionBriefSchema),
  /** Repos whose card a section already shows. */
  pictured: z.array(z.string()),
});

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

interface StreamedText {
  text: string;
  finishReason: string;
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
 */
async function streamAgent(
  agent: Agent,
  prompt: string,
  requestContext: RequestContext,
  onDelta?: (delta: string) => Promise<void>,
): Promise<StreamedText> {
  const output = await agent.stream(prompt, {
    requestContext,
    modelSettings: { temperature: DEFAULT_TEMPERATURE, maxRetries: 0 },
  });
  for await (const delta of output.textStream) await onDelta?.(delta);
  const [text, finishReason] = await Promise.all([output.text, output.finishReason]);
  if (finishReason === "error") throw new Error(describeAiError(output.error));
  return { text: text ?? "", finishReason: finishReason ?? "unknown" };
}

/** A reply too broken to use: cut off mid-generation, or nothing at all. */
function isUnusable(result: StreamedText): boolean {
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
    const research = researchPeriod(activity, details);

    const knownRepos = [...new Set(activity.map((item) => item.repo).filter((repo): repo is string => Boolean(repo?.includes("/"))))];
    return {
      periodLabel,
      cadence: inputData.period,
      dossier: research.text,
      repoDossiers: Object.fromEntries(knownRepos.map((repo) => [repo, research.forRepo(repo)])),
      knownRepos,
      numbersArticle: buildByTheNumbersArticle(activity),
      starsArticle: buildStarsArticle(activity, details),
      starCandidates: starImageCandidates(activity, details),
    };
  },
});

const plan = createStep({
  id: "plan",
  description: "Ask the outline editor for the headline, premise and section briefs; check each brief's repo against the real ones.",
  inputSchema: gatheredSchema,
  outputSchema: planSchema,
  execute: async ({ inputData, mastra, requestContext, writer }) => {
    const out = page(writer);
    await out.write({ event: "status", data: { message: "Planning the front page…" } });

    const editor = mastra.getAgent("outlineEditor");
    const prompt = buildOutlinePrompt({ periodLabel: inputData.periodLabel, cadence: inputData.cadence, sourceText: inputData.dossier });
    let reply = await streamAgent(editor, prompt, requestContext);
    if (isUnusable(reply)) {
      console.warn(`[front-page] outline truncated/empty (finishReason: ${reply.finishReason}) — retrying once`);
      reply = await streamAgent(editor, prompt, requestContext);
    }
    if (isUnusable(reply)) {
      throw new Error(
        `The outline came back truncated/empty twice in a row (finishReason: ${reply.finishReason}). ` +
          "The provider may be enforcing its own token ceiling, or the model may be failing silently.",
      );
    }

    const outline = parseOutline(reply.text);
    // A weak model can write fine prose yet miss the "## heading" / "BRIEF:"
    // shape — one section over the whole period beats failing the edition.
    if (outline.sections.length === 0) {
      outline.sections = [{ heading: outline.title || inputData.periodLabel, brief: "Cover the period's activity as a whole.", lengthTier: "medium" }];
    }
    const title = outline.title || inputData.periodLabel;

    // Each repo's card appears at most once on the page.
    const repos = new Map(inputData.knownRepos.map((repo) => [repo.toLowerCase(), repo]));
    const pictured = new Set<string>();
    const sections = outline.sections.map((section, index) => {
      const repo = resolveRepo(section.repo, repos);
      const imageUrl = repo && !pictured.has(repo) ? repoImageUrl(repo) : null;
      if (repo) pictured.add(repo);
      return {
        index,
        heading: section.heading,
        brief: section.brief,
        lengthTier: section.lengthTier,
        repo,
        imageUrl,
        premise: outline.premise,
        periodLabel: inputData.periodLabel,
        // A section about one repo reads that repo's dossier (plus an index
        // of the rest) — focused, and a fraction of the tokens.
        sourceText: (repo && inputData.repoDossiers[repo]) || inputData.dossier,
      };
    });

    const total = sections.length + (inputData.starsArticle ? 1 : 0) + (inputData.numbersArticle ? 1 : 0);
    await out.write({ event: "layout", data: { layout: pickLayoutForContent(total) } });
    return { title, premise: outline.premise, sections, pictured: [...pictured] };
  },
});

const writeSection = createStep({
  id: "write-section",
  description: "Have the correspondent write one section, streaming it to the page as it's written.",
  inputSchema: sectionBriefSchema,
  outputSchema: sectionResultSchema,
  execute: async ({ inputData, mastra, requestContext, writer }) => {
    const out = page(writer);
    const { index } = inputData;
    await out.write({
      event: "section-start",
      data: { index, heading: inputData.heading, category: "Dispatch", author: "The Albricias Correspondent", deck: inputData.brief, imageUrl: inputData.imageUrl },
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
        const reply = await streamAgent(mastra.getAgent("correspondent"), buildSectionPrompt(inputData), requestContext, (delta) =>
          send(headings.push(delta)),
        );
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
    const planned = getStepResult(plan);

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
    if (gathered.starsArticle) {
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
  .map(async ({ inputData }) => inputData.sections)
  .foreach(writeSection, { concurrency: SECTION_CONCURRENCY })
  .then(assemble)
  .commit();
