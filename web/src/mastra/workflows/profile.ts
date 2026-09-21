/**
 * Profile workflow — outline → per-section drafts → assemble.
 *
 * Replaces a single big "write the whole 900–1500 word profile in one call"
 * request with several small, tightly-scoped ones: `build-outline` proposes
 * a handful of sections, each pointed at just the relevant slice of the
 * source material, then `write-section` writes each one independently.
 * Built to address a real, repeated failure: the self-hosted "thinking"
 * model behind this app's LiteLLM proxy sometimes reasons forever on a
 * long, demanding profile prompt and returns empty text (see
 * `runNewspaperAgent`'s doc comment in `@/mastra/agents/base`) — raising or
 * removing the token budget already didn't fix this, so the lever left is
 * what one call is *asked to do*, not how many tokens it's allowed.
 *
 * Shape:
 *   build-outline  →  foreach(write-section, { concurrency: PROFILE_SECTION_CONCURRENCY })  →  assemble-article
 *
 * Unlike `chronicle.ts`'s live per-section progress (streamed into
 * `Edition.generationProgress` so the admin can watch a whole-edition run
 * happen), this workflow's progress isn't surfaced live — a profile article
 * is generated one at a time, already behind the app's existing coarse
 * "writing…" single-piece retry UI (`beginSinglePieceRetry` in
 * `@/lib/generation`), so there's no separate live view to feed, and this
 * runs via `run.start()` rather than `run.stream()`. Every step's own
 * prompt/response/timing is still captured, just after the fact: each step
 * folds its own trace fields into what it hands the next one (see
 * `sectionJobSchema`/`sectionOutcomeSchema` below), and `assemble-article`
 * — the last step — is where that's finally shaped into the
 * `GenerationTrace` object (`@/mastra/schemas`) persisted at
 * `Article.sourceData.generationTrace` by `@/lib/generation`'s
 * `generateArticleFromSource` and read back by `regenerateProfileSection`.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { MODEL_NAME, profileOutlineAgent, profileSectionAgent, runNewspaperAgent } from "../agents";
import {
  type GenerationTrace,
  generatorResultSchema,
  generationTraceSchema,
  resolvedAiModelSchema,
} from "../schemas";

/** Same rationale as `CHRONICLE_CONCURRENCY` (`chronicle.ts`): the self-hosted model drops proxy connections under concurrent load. */
export const PROFILE_SECTION_CONCURRENCY = 1;

const profileInputSchema = z.object({
  /** Source material (a README, notes, transcription — whatever the source processor produced). */
  text: z.string(),
  subjectName: z.string().default(""),
  topicHint: z.string().default(""),
  aiModel: resolvedAiModelSchema.optional(),
});
export type ProfileWorkflowInput = z.input<typeof profileInputSchema>;

const outlineTraceSchema = z.object({
  prompt: z.string(),
  response: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
});

/** One outline section, carried through the `foreach` — each job echoes the shared outline fields so `assemble-article` doesn't need separate state passed alongside the array. */
const sectionJobSchema = z.object({
  index: z.number().int(),
  heading: z.string(),
  brief: z.string(),
  sourceExcerpt: z.string(),
  premise: z.string(),
  title: z.string(),
  subjectName: z.string(),
  aiModel: resolvedAiModelSchema.optional(),
  outlineTrace: outlineTraceSchema,
});

const sectionOutcomeSchema = z.object({
  index: z.number().int(),
  heading: z.string(),
  brief: z.string(),
  ok: z.boolean(),
  markdown: z.string().nullable(),
  prompt: z.string(),
  response: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  error: z.string().nullable(),
  title: z.string(),
  premise: z.string(),
  outlineTrace: outlineTraceSchema,
});

// ---------------------------------------------------------------------------
// Outline: prompt, parsing, source chunking
// ---------------------------------------------------------------------------

function withTopicHint(prompt: string, topicHint: string): string {
  return topicHint ? `${prompt}\n\nAdditional focus: ${topicHint}` : prompt;
}

export function buildProfileOutlinePrompt(input: {
  text: string;
  subjectName: string;
  topicHint: string;
}): string {
  const subjectLine = input.subjectName
    ? `The subject of the profile is: ${input.subjectName}.\n\n`
    : "";
  return withTopicHint(
    `${subjectLine}Source material:\n${input.text}\n`,
    input.topicHint,
  );
}

interface ParsedOutlineSection {
  heading: string;
  brief: string;
  sourceRef: string;
}

interface ParsedOutline {
  title: string;
  premise: string;
  sections: ParsedOutlineSection[];
}

/** Parses `PROFILE_OUTLINE_SYSTEM`'s plain-text convention. Never throws — an unparseable response just yields zero sections, which the caller treats as a step failure. */
export function parseOutline(raw: string): ParsedOutline {
  const lines = raw.trim().split("\n");
  let title = "";
  let premise = "";
  const sections: ParsedOutlineSection[] = [];
  let current: ParsedOutlineSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), brief: "", sourceRef: "" };
    } else if (line.startsWith("PREMISE:")) {
      premise = line.slice("PREMISE:".length).trim();
    } else if (line.startsWith("BRIEF:") && current) {
      current.brief = line.slice("BRIEF:".length).trim();
    } else if (line.startsWith("SOURCE:") && current) {
      current.sourceRef = line.slice("SOURCE:".length).trim();
    }
  }
  if (current) sections.push(current);

  return {
    title,
    premise,
    sections: sections.filter((section) => section.heading),
  };
}

interface SourceChunk {
  heading: string;
  text: string;
}

/** Splits markdown-ish source text on its own `#`-`######` headings — READMEs are already structured this way, so this needs no LLM call. */
export function splitSourceIntoChunks(source: string): SourceChunk[] {
  const lines = source.split("\n");
  const chunks: SourceChunk[] = [];
  let current: { heading: string; lines: string[] } = { heading: "Introduction", lines: [] };

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.*)/);
    if (match) {
      chunks.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: match[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  chunks.push({ heading: current.heading, text: current.lines.join("\n").trim() });

  return chunks.filter((chunk) => chunk.text.length > 0);
}

/** Resolves an outline section's `SOURCE:` reference against the source's own chunks; falls back to the whole source (never an empty excerpt) when nothing matches. */
export function resolveSourceExcerpt(
  chunks: SourceChunk[],
  sourceRef: string,
  fullSource: string,
): string {
  if (!sourceRef.trim()) return fullSource;
  const needle = sourceRef.toLowerCase();
  const matches = chunks.filter(
    (chunk) =>
      needle.includes(chunk.heading.toLowerCase()) || chunk.heading.toLowerCase().includes(needle),
  );
  if (matches.length === 0) return fullSource;
  return matches.map((chunk) => `## ${chunk.heading}\n${chunk.text}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Section: prompt
// ---------------------------------------------------------------------------

export function buildProfileSectionPrompt(input: {
  heading: string;
  brief: string;
  premise: string;
  subjectName: string;
  sourceExcerpt: string;
}): string {
  const subjectLine = input.subjectName ? `The subject of the piece is: ${input.subjectName}.\n\n` : "";
  return (
    `${subjectLine}The piece's overall premise: ${input.premise}\n\n` +
    `Write the section titled "${input.heading}". ${input.brief}\n\n` +
    `Source material for this section:\n${input.sourceExcerpt}\n`
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const buildOutlineStep = createStep({
  id: "build-outline",
  description:
    "Plan a profile article: a headline, a throughline premise, and a handful of sections, each pointed at the relevant slice of the source material.",
  inputSchema: profileInputSchema,
  outputSchema: z.array(sectionJobSchema),
  execute: async ({ inputData }) => {
    const prompt = buildProfileOutlinePrompt(inputData);
    const startedAt = new Date().toISOString();
    const raw = await runNewspaperAgent(profileOutlineAgent, {
      user: prompt,
      aiModel: inputData.aiModel,
    });
    const endedAt = new Date().toISOString();
    const outline = parseOutline(raw);
    if (outline.sections.length === 0) {
      throw new Error("The outline call produced no sections to write.");
    }

    const chunks = splitSourceIntoChunks(inputData.text);
    const outlineTrace = { prompt, response: raw, startedAt, endedAt };
    const title = outline.title || inputData.subjectName || "A Profile of a Notable Project";

    return outline.sections.map((section, index) => ({
      index,
      heading: section.heading,
      brief: section.brief,
      sourceExcerpt: resolveSourceExcerpt(chunks, section.sourceRef, inputData.text),
      premise: outline.premise,
      title,
      subjectName: inputData.subjectName,
      aiModel: inputData.aiModel,
      outlineTrace,
    }));
  },
});

/**
 * Whole body in try/catch, not just the model call — a Mastra-level step
 * failure inside a `foreach` calls `killQueue()`, dropping every iteration
 * that hasn't started yet (see `chronicle.ts`'s `write-category-article`,
 * the same pattern, with the full citation). Resolving every error as a
 * normal `{ ok: false }` outcome is what makes "one bad section never
 * touches the others" a property of this step.
 */
const writeSectionStep = createStep({
  id: "write-section",
  description: "Write one section of the profile.",
  inputSchema: sectionJobSchema,
  outputSchema: sectionOutcomeSchema,
  execute: async ({ inputData }) => {
    const prompt = buildProfileSectionPrompt(inputData);
    const startedAt = new Date().toISOString();
    const shared = {
      index: inputData.index,
      heading: inputData.heading,
      brief: inputData.brief,
      prompt,
      title: inputData.title,
      premise: inputData.premise,
      outlineTrace: inputData.outlineTrace,
    };
    try {
      const raw = await runNewspaperAgent(profileSectionAgent, {
        user: prompt,
        aiModel: inputData.aiModel,
      });
      return {
        ...shared,
        ok: true,
        markdown: raw.trim(),
        response: raw,
        startedAt,
        endedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      console.error(
        `[profile] section "${inputData.heading}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ...shared,
        ok: false,
        markdown: null,
        response: null,
        startedAt,
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/** No LLM call — mechanical join, plus building the `GenerationTrace` persisted alongside the article. */
const assembleArticleStep = createStep({
  id: "assemble-article",
  description: "Join the outline and section drafts into one article, and record the full generation trace.",
  inputSchema: z.array(sectionOutcomeSchema),
  outputSchema: generatorResultSchema,
  execute: async ({ inputData }) => {
    const sorted = [...inputData].sort((a, b) => a.index - b.index);
    const first = sorted[0];

    const body = sorted
      .map((section) =>
        section.ok && section.markdown
          ? `## ${section.heading}\n\n${section.markdown}`
          : `## ${section.heading}\n\n> _This section could not be generated and was skipped — see the generation trace._`,
      )
      .join("\n\n");
    const content = `${first.premise}\n\n${body}`.trim();

    const succeeded = sorted.filter((section) => section.ok).length;
    const status: GenerationTrace["status"] =
      succeeded === sorted.length ? "success" : succeeded > 0 ? "partial" : "failed";

    const generationTrace: GenerationTrace = generationTraceSchema.parse({
      workflowId: "profile-deep-dive",
      startedAt: first.outlineTrace.startedAt,
      endedAt: new Date().toISOString(),
      status,
      outline: {
        prompt: first.outlineTrace.prompt,
        response: first.outlineTrace.response,
        title: first.title,
        premise: first.premise,
        startedAt: first.outlineTrace.startedAt,
        endedAt: first.outlineTrace.endedAt,
      },
      sections: sorted.map((section) => ({
        index: section.index,
        heading: section.heading,
        brief: section.brief,
        status: section.ok ? "success" : "failed",
        prompt: section.prompt,
        response: section.response ?? undefined,
        startedAt: section.startedAt,
        endedAt: section.endedAt,
        error: section.error ?? undefined,
      })),
    });

    return {
      title: first.title,
      content,
      category: "Front Page",
      sourceData: {
        generator: "profile-deep-dive",
        model: MODEL_NAME,
        generationTrace,
      },
    };
  },
});

export const profileWorkflow = createWorkflow({
  id: "profile-deep-dive",
  description: "Write a profile/feature article from source material via an outline-then-sections pipeline.",
  inputSchema: profileInputSchema,
  outputSchema: generatorResultSchema,
})
  .then(buildOutlineStep)
  .foreach(writeSectionStep, { concurrency: PROFILE_SECTION_CONCURRENCY })
  .then(assembleArticleStep)
  .commit();
