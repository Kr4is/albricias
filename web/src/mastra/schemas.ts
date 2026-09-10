/**
 * Zod schemas shared by the Mastra agents, the Mastra workflows, and the
 * plain-TypeScript orchestration in `src/lib/generation`.
 *
 * `GeneratorResult` is the direct port of the dataclass in
 * `app/services/generators/__init__.py`; `ActivityInput` is the reduced view of
 * a `ServiceActivity` row that `ai_writer.generate_edition_draft` built by hand
 * before handing it to the chronicle generator.
 */

import { z } from "zod";

/**
 * Serialisable mirror of `ResolvedAiModel` (`./agents/base`) — the same
 * shape, but as a Zod schema so it can travel through a workflow's
 * `inputSchema` (Mastra workflow steps validate/serialise their input).
 * `id` keeps Mastra's own `"provider/model"` template-literal type via
 * `z.custom` so it stays assignable everywhere `ResolvedAiModel` is.
 */
export const resolvedAiModelSchema = z.object({
  id: z.custom<`${string}/${string}`>(
    (val) => typeof val === "string" && val.includes("/"),
    { message: "Expected a \"provider/model\" string." },
  ),
  apiKey: z.string().optional(),
  url: z.string().optional(),
});

/** Structured output from any article generator. */
export const generatorResultSchema = z.object({
  title: z.string(),
  /** Markdown body. */
  content: z.string(),
  /** Suggested newspaper section. */
  category: z.string(),
  /** Prompt, raw response, model, and generator-specific extras. */
  sourceData: z.record(z.string(), z.unknown()),
});

export type GeneratorResult = z.infer<typeof generatorResultSchema>;

/** The subset of a `ServiceActivity` row the chronicle workflow reads. */
export const activityInputSchema = z.object({
  eventType: z.string(),
  repo: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  timestamp: z.date().nullable(),
});

export type ActivityInput = z.infer<typeof activityInputSchema>;

/** Ported from `GENERATORS` in `app/services/generators/__init__.py`. */
export const generatorTypeSchema = z.enum([
  "reflection",
  "interview",
  "review",
  "profile",
]);

export type GeneratorType = z.infer<typeof generatorTypeSchema>;

export const GENERATORS: Record<GeneratorType, string> = {
  reflection: "Reflection / Essay",
  interview: "Interview",
  review: "Review",
  profile: "Profile / Feature",
};

/** Ported from `GENERATOR_CATEGORIES`. */
export const GENERATOR_CATEGORIES: Record<GeneratorType, string> = {
  reflection: "Editorial",
  interview: "Front Page",
  review: "Arts & Letters",
  profile: "Front Page",
};

/** Ported from `_SUBJECT_LABELS` in `app/services/generators/review.py`. */
export const reviewSubjectTypeSchema = z.enum([
  "book",
  "film",
  "tool",
  "restaurant",
  "album",
  "other",
]);

export type ReviewSubjectType = z.infer<typeof reviewSubjectTypeSchema>;
