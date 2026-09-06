/**
 * Social-copy desk — turns a published edition into per-network post text.
 *
 * Deliberately a standalone `Agent` instance, not added to the shared
 * `agents`/`workflows` registry in `./index.ts` / `../index.ts` (the Mastra
 * instance) — those files are being edited concurrently by the Phase C
 * (rankings) agent working in the same wave, and `Agent.generate()` works
 * standalone without central registration (registration only wires an agent
 * into the Mastra dev playground's shared logger/storage, per
 * `../index.ts`'s own doc comment). Importing `runNewspaperAgent`/`MODEL_ID`
 * directly from `./base` (not the `./index` barrel) for the same
 * conflict-avoidance reason.
 */

import { Agent } from "@mastra/core/agent";
import { MODEL_ID, NEWSPAPER_PERSONA } from "./base";

/** Tuned for social brevity, not the long-form newspaper voice. */
export const SOCIAL_COPY_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are now writing for the paper's social media desk, promoting a newly " +
  "published edition. Keep the vintage newspaper wit, but adapt it to short, " +
  "punchy, shareable social copy — no markdown formatting, no headlines. " +
  "Never include a URL yourself; the caller appends the edition link " +
  "separately, after your text.";

export const socialCopyAgent = new Agent({
  id: "social-copy",
  name: "Albricias Social Desk",
  description: "Writes per-network social post copy promoting a published edition.",
  instructions: SOCIAL_COPY_SYSTEM,
  model: MODEL_ID,
});
