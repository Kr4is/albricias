/**
 * Assisted-generation workflow — normalized source text → one article.
 *
 * Ports the four generator modules under `app/services/generators/`
 * (`reflection.py`, `interview.py`, `review.py`, `profile.py`). Their system
 * prompts live on the corresponding Mastra agents; their user-prompt templates,
 * fallback headlines, categories, token budgets and `source_data` payloads are
 * reproduced verbatim here.
 *
 * Shape:
 *   branch(reflection | interview | review | profile | tutorial)  →  unwrap-branch
 *
 * `tutorial` is the one generator with no Python ancestor — see
 * {@link buildTutorialPrompt}.
 *
 * Source *processing* (Whisper transcription, text normalisation) stays outside
 * the workflow, in `src/lib/sources/`, because binary uploads do not belong in
 * a serialisable workflow input.
 */

import { type Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  MODEL_NAME,
  interviewAgent,
  parseResponse,
  profileAgent,
  reflectionAgent,
  reviewAgent,
  runNewspaperAgent,
  tutorialAgent,
} from "../agents";
import {
  type GeneratorResult,
  generatorResultSchema,
  generatorTypeSchema,
  resolvedAiModelSchema,
  reviewSubjectTypeSchema,
} from "../schemas";


/** Verbatim from `review.py:_SUBJECT_LABELS`. */
const SUBJECT_LABELS: Record<string, string> = {
  book: "Book",
  film: "Film",
  tool: "Software / Tool",
  restaurant: "Restaurant",
  album: "Album / Music",
  other: "",
};

const assistedInputSchema = z.object({
  /** Normalized source text (a transcription, prose, or notes). */
  text: z.string(),
  generatorType: generatorTypeSchema,
  /** Optional extra focus instruction, appended to every prompt. */
  topicHint: z.string().default(""),
  /** Review / profile generators: the thing being written about. */
  subjectName: z.string().default(""),
  /** Review generator only. */
  subjectType: reviewSubjectTypeSchema.default("other"),
  /** Interview generator only. */
  intervieweeName: z.string().default(""),
  /** Resolved AI text-generation provider/model — see `@/lib/ai/provider`. */
  aiModel: resolvedAiModelSchema.optional(),
});

export type AssistedGenerationInput = z.input<typeof assistedInputSchema>;

type AssistedInput = z.output<typeof assistedInputSchema>;

/** Append the shared `Additional focus:` suffix, as every generator does. */
function withTopicHint(prompt: string, topicHint: string): string {
  return topicHint ? `${prompt}\n\nAdditional focus: ${topicHint}` : prompt;
}

// ---------------------------------------------------------------------------
// Prompt builders — one per Python generator module
// ---------------------------------------------------------------------------

/** Ported from `reflection.py:_PROMPT_TEMPLATE`. */
export function buildReflectionPrompt(input: AssistedInput): string {
  return withTopicHint(
    "Based on the following notes or transcription, write a reflective essay / opinion " +
      "column for ¡Albricias!.\n" +
      "\n" +
      "The article must begin with a compelling headline (formatted as a Markdown H1), " +
      "followed by the body. Do not include a byline or date.\n" +
      "\n" +
      "Source material:\n" +
      `${input.text}\n`,
    input.topicHint,
  );
}

/** Ported from `interview.py:_PROMPT_TEMPLATE`. */
export function buildInterviewPrompt(input: AssistedInput): string {
  const intervieweeLine = input.intervieweeName
    ? `The person being interviewed is: ${input.intervieweeName}.\n\n`
    : "";
  return withTopicHint(
    "Based on the following conversation or interview transcription, write a polished " +
      "Q&A article for ¡Albricias!.\n" +
      "\n" +
      "Begin with a compelling headline (Markdown H1), then a short editorial introduction, " +
      "then the Q&A body. Do not include a byline or date.\n" +
      "\n" +
      `${intervieweeLine}Transcription:\n` +
      `${input.text}\n`,
    input.topicHint,
  );
}

/** Ported from `review.py:_PROMPT_TEMPLATE`. */
export function buildReviewPrompt(input: AssistedInput): string {
  const label = SUBJECT_LABELS[input.subjectType] ?? "";
  const subjectLine = input.subjectName
    ? `The subject being reviewed is: ${label ? `${label} — ` : ""}${input.subjectName}.\n\n`
    : "";
  return withTopicHint(
    "Based on the following notes, write a vintage-style review article for ¡Albricias!.\n" +
      "\n" +
      `${subjectLine}Begin with a compelling headline (Markdown H1), then the review body with a clear ` +
      "verdict at the end. Do not include a byline or date.\n" +
      "\n" +
      "Notes:\n" +
      `${input.text}\n`,
    input.topicHint,
  );
}

/** Ported from `profile.py:_PROMPT_TEMPLATE`. */
export function buildProfilePrompt(input: AssistedInput): string {
  const subjectLine = input.subjectName
    ? `The subject of the profile is: ${input.subjectName}.\n\n`
    : "";
  return withTopicHint(
    "Based on the following notes or transcription, write a profile / feature article " +
      "for ¡Albricias!.\n" +
      "\n" +
      `${subjectLine}Begin with a compelling headline (Markdown H1), then the narrative body. ` +
      "Do not include a byline or date.\n" +
      "\n" +
      "Source material:\n" +
      `${input.text}\n`,
    input.topicHint,
  );
}

/**
 * No Python original — new with the `github-repo-article-generators` plan,
 * built on `buildReviewPrompt`'s shape (subject line, instruction, headline/
 * body framing, source material last). The negative instructions are the point
 * of the prompt, not padding: a README is itself largely promotional, so
 * without them the model restates the project's pitch instead of teaching.
 */
export function buildTutorialPrompt(input: AssistedInput): string {
  const subjectLine = input.subjectName
    ? `The project being taught is: ${input.subjectName}.\n\n`
    : "";
  return withTopicHint(
    "Based on the following project documentation, write a minimal, practical " +
      "getting-started tutorial for ¡Albricias!.\n" +
      "\n" +
      `${subjectLine}Begin with a compelling headline (Markdown H1), then the tutorial body: ` +
      "the concrete steps a reader would actually follow to get this working, in order, " +
      "drawn from the source material. Do not restate the project's description or sell " +
      "its merits. Do not include a byline or date.\n" +
      "\n" +
      "Source material:\n" +
      `${input.text}\n`,
    input.topicHint,
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface GeneratorSpec {
  stepId: string;
  agent: Agent;
  /** Value recorded as `sourceData.generator`. */
  generator: string;
  category: string;
  fallbackTitle: string;
  maxTokens?: number;
  buildPrompt: (input: AssistedInput) => string;
  /** Generator-specific keys merged into `sourceData`. */
  extraSourceData: (input: AssistedInput) => Record<string, unknown>;
}

function makeGeneratorStep(spec: GeneratorSpec) {
  return createStep({
    id: spec.stepId,
    description: `Write a ${spec.generator} piece for the ${spec.category} section.`,
    inputSchema: assistedInputSchema,
    outputSchema: generatorResultSchema,
    execute: async ({ inputData }) => {
      const prompt = spec.buildPrompt(inputData);
      const raw = await runNewspaperAgent(spec.agent, {
        user: prompt,
        aiModel: inputData.aiModel,
        maxTokens: spec.maxTokens,
      });
      const { title, content } = parseResponse(raw, spec.fallbackTitle);
      return {
        title,
        content,
        category: spec.category,
        sourceData: {
          generator: spec.generator,
          prompt,
          response: raw,
          model: MODEL_NAME,
          ...spec.extraSourceData(inputData),
        },
      };
    },
  });
}

const reflectionStep = makeGeneratorStep({
  stepId: "generate-reflection",
  agent: reflectionAgent,
  generator: "reflection",
  category: "Editorial",
  fallbackTitle: "Reflections From the Correspondent's Desk",
  buildPrompt: buildReflectionPrompt,
  extraSourceData: (input) => ({ topic_hint: input.topicHint }),
});

const interviewStep = makeGeneratorStep({
  stepId: "generate-interview",
  agent: interviewAgent,
  generator: "interview",
  category: "Front Page",
  fallbackTitle: "An Interview With a Remarkable Personage",
  buildPrompt: buildInterviewPrompt,
  extraSourceData: (input) => ({
    interviewee_name: input.intervieweeName,
    topic_hint: input.topicHint,
  }),
});

const reviewStep = makeGeneratorStep({
  stepId: "generate-review",
  agent: reviewAgent,
  generator: "review",
  category: "Arts & Letters",
  fallbackTitle: "A Critic's Assessment",
  buildPrompt: buildReviewPrompt,
  extraSourceData: (input) => ({
    subject_name: input.subjectName,
    subject_type: input.subjectType,
    topic_hint: input.topicHint,
  }),
});

const profileStep = makeGeneratorStep({
  stepId: "generate-profile",
  agent: profileAgent,
  generator: "profile",
  category: "Front Page",
  fallbackTitle: "A Profile of a Notable Figure",
  buildPrompt: buildProfilePrompt,
  extraSourceData: (input) => ({
    subject_name: input.subjectName,
    topic_hint: input.topicHint,
  }),
});

/**
 * No `maxTokens` here, same as every other generator now — none of the five
 * pass one. `interview`/`profile` used to (`LONG_FORM_MAX_TOKENS = 900`,
 * ported from `interview.py`/`profile.py` raising the 800 default), but a
 * live run against a real reasoning-model deployment surfaced the fix
 * `@/mastra/agents/base`'s `runNewspaperAgent` already made for chronicle and
 * the ranking generators had never been applied here: an explicit cap that
 * small reasoning-truncates the exact same way — verified against the same
 * finishReason: "length" failure this codebase already fixed once — and the
 * retry in `runNewspaperAgent` reuses the caller's own `maxTokens`, so a
 * capped call fails identically twice, not just once. Removing the cap here
 * too was the fix, not a new tutorial-specific accommodation.
 */
const tutorialStep = makeGeneratorStep({
  stepId: "generate-tutorial",
  agent: tutorialAgent,
  generator: "tutorial",
  category: "How-To",
  fallbackTitle: "A Practical Primer for the Curious Reader",
  buildPrompt: buildTutorialPrompt,
  extraSourceData: (input) => ({
    subject_name: input.subjectName,
    topic_hint: input.topicHint,
  }),
});

const BRANCH_STEP_IDS = [
  "generate-reflection",
  "generate-interview",
  "generate-review",
  "generate-profile",
  "generate-tutorial",
] as const;

/**
 * Source text + generator type → one `GeneratorResult`.
 *
 * `generatorType` is validated by the input schema, so exactly one branch runs;
 * `unwrap-branch` picks the single populated key out of the branch result.
 */
export const assistedGenerationWorkflow = createWorkflow({
  id: "assisted-generation",
  description:
    "Write one vintage article from normalized source text using the requested generator desk.",
  inputSchema: assistedInputSchema,
  outputSchema: generatorResultSchema,
})
  .branch([
    [async ({ inputData }) => inputData.generatorType === "reflection", reflectionStep],
    [async ({ inputData }) => inputData.generatorType === "interview", interviewStep],
    [async ({ inputData }) => inputData.generatorType === "review", reviewStep],
    [async ({ inputData }) => inputData.generatorType === "profile", profileStep],
    [async ({ inputData }) => inputData.generatorType === "tutorial", tutorialStep],
  ])
  .map(async ({ inputData }) => {
    const branches = inputData as Record<string, GeneratorResult | undefined>;
    for (const stepId of BRANCH_STEP_IDS) {
      const result = branches[stepId];
      if (result) return result;
    }
    throw new Error("No generator branch produced a result.");
  }, { id: "unwrap-branch" })
  .commit();
