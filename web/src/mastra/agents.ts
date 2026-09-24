/**
 * The two newsroom agents. Each is just its instructions — the prompts in
 * `@/lib/generation/period-post` — plus the run's model (`runModel`); the
 * `front-page` workflow decides what to ask them and when.
 */

import { Agent } from "@mastra/core/agent";
import { PERIOD_POST_OUTLINE_SYSTEM, PERIOD_POST_SECTION_SYSTEM } from "@/lib/generation/period-post";
import { runModel } from "./model";

/** Plans the front page: headline, premise, and a brief per section. Writes no prose. */
export const outlineEditor = new Agent({
  id: "outline-editor",
  name: "Outline editor",
  description: "Plans a front page from the period's GitHub dossier: headline, premise, and one brief per section.",
  instructions: PERIOD_POST_OUTLINE_SYSTEM,
  model: runModel,
});

/** Writes one section from its brief and the material it's given. */
export const correspondent = new Agent({
  id: "correspondent",
  name: "Correspondent",
  description: "Writes one front-page section, in the paper's voice, from its brief and material.",
  instructions: PERIOD_POST_SECTION_SYSTEM,
  model: runModel,
});
