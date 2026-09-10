/**
 * Mastra workflows.
 *
 * `chronicle`           — activity rows → one dispatch per newspaper section.
 * `assisted-generation` — source text → one article from the requested desk.
 *
 * Single-article regeneration is a one-shot agent call rather than a workflow;
 * it lives in `src/lib/generation/index.ts` next to its Prisma write.
 */

export {
  type ChronicleCategory,
  type ChronicleInput,
  CATEGORIES,
  CATEGORY_PROMPTS,
  CHRONICLE_CONCURRENCY,
  EVENT_CATEGORY_MAP,
  buildChroniclePrompt,
  chronicleWorkflow,
  groupActivities,
  summariseGroup,
} from "./chronicle";

export {
  type AssistedGenerationInput,
  assistedGenerationWorkflow,
  buildInterviewPrompt,
  buildProfilePrompt,
  buildReflectionPrompt,
  buildReviewPrompt,
} from "./assisted";

import { assistedGenerationWorkflow } from "./assisted";
import { chronicleWorkflow } from "./chronicle";

/** Registered on the Mastra instance in `src/mastra/index.ts`. */
export const workflows = {
  chronicle: chronicleWorkflow,
  "assisted-generation": assistedGenerationWorkflow,
};
