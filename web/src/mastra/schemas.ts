/**
 * Zod schemas shared by the Mastra agents and the period-post workflow.
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

/** One normalised GitHub activity event, as the period-post workflow reads it. */
export const activityInputSchema = z.object({
  eventType: z.string(),
  repo: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  timestamp: z.date().nullable(),
});

export type ActivityInput = z.infer<typeof activityInputSchema>;
