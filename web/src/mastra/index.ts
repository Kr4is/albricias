/**
 * Mastra instance for Albricias.
 *
 * Next.js needs every `@mastra/*` package listed by name in
 * `serverExternalPackages` (next.config.ts) — the `@mastra/*` glob from
 * Mastra's own docs is matched literally by Next and silently matches
 * nothing.
 */

import { Mastra } from "@mastra/core";

import { agents } from "./agents";
import { periodPostWorkflow } from "./workflows/period-post";

export const mastra = new Mastra({
  agents,
  workflows: { periodPost: periodPostWorkflow },
});
