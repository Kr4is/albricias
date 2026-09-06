/**
 * Mastra instance for Albricias.
 *
 * Registers the five newspaper-desk agents (`./agents`) and the two generation
 * workflows (`./workflows`). Registration is what makes them visible to the
 * Mastra dev playground and gives them the shared logger/storage; the exported
 * `chronicleWorkflow` / `assistedGenerationWorkflow` objects can also be run
 * directly, which is what `src/lib/generation` does.
 *
 * Next.js needs every `@mastra/*` package listed by name in
 * `serverExternalPackages` (next.config.ts) — the `@mastra/*` glob from Mastra's
 * own docs is matched literally by Next and silently matches nothing.
 */

import { Mastra } from "@mastra/core";

import { agents } from "./agents";
import { workflows } from "./workflows";

export const mastra = new Mastra({
  agents,
  workflows,
});
