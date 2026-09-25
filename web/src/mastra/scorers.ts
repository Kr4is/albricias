/**
 * Scorers — Mastra's evals — on the workflow's steps: every run scored as
 * it happens, the scores stored with the run and shown in Studio (the step
 * and trace views, and the Scorers screen), so a change to a prompt or a
 * model shows up as numbers across runs instead of impressions of one.
 *
 * All of them are code, not a model judging a model: they cost nothing,
 * never need the visitor's key, and say exactly what they found
 * (`@/lib/generation/checks`):
 *
 *   on write-section   figures-grounded   the prose's numbers are in its material
 *                      repos-grounded     the repositories it names are too
 *                      length-fit         its length against its tier's band
 *                      house-style        no "the user", no meta, no markup
 *   on review          outline-clean      how little the review had to fix
 *
 * Local only: production keeps no store to put scores in (`@/mastra`).
 */

import { createScorer, type MastraScorers } from "@mastra/core/evals";

import { lengthFit, styleBreaches, ungroundedFigures, unknownRepos, wordCount } from "@/lib/generation/checks";
import type { LengthTier } from "@/lib/generation/outline";

/** What `write-section` scorers see: the section's brief in, its prose and material out. */
interface SectionRun {
  input?: { heading: string; lengthTier: LengthTier };
  output: { ok: boolean; text: string; material: string };
}

const parse = (material: string): unknown => {
  try {
    return JSON.parse(material);
  } catch {
    return material;
  }
};

/** A share of checks that passed, as a score (1 when there was nothing to check). */
const share = (checked: number, failed: number) => (checked === 0 ? 1 : (checked - failed) / checked);

export const figuresGrounded = createScorer<SectionRun["input"], SectionRun["output"]>({
  id: "figures-grounded",
  description: "Share of the numbers in a section's prose that appear in the material it was given.",
})
  .preprocess(({ run }) => ungroundedFigures(run.output.text, parse(run.output.material)))
  .generateScore(({ results }) => share(results.preprocessStepResult.checked, results.preprocessStepResult.unmatched.length))
  .generateReason(({ results }) => {
    const { checked, unmatched } = results.preprocessStepResult;
    if (checked === 0) return "No figures to check.";
    return unmatched.length === 0 ? `All ${checked} figures are in the material.` : `Not in the material: ${unmatched.join(", ")} (of ${checked} figures).`;
  });

export const reposGrounded = createScorer<SectionRun["input"], SectionRun["output"]>({
  id: "repos-grounded",
  description: "Share of the owner/name repositories a section names that its material names too.",
})
  .preprocess(({ run }) => unknownRepos(run.output.text, parse(run.output.material)))
  .generateScore(({ results }) => share(results.preprocessStepResult.checked, results.preprocessStepResult.unmatched.length))
  .generateReason(({ results }) => {
    const { checked, unmatched } = results.preprocessStepResult;
    if (checked === 0) return "No owner/name repositories named.";
    return unmatched.length === 0 ? `${checked} repositories named, all real.` : `Not in the material: ${unmatched.join(", ")}.`;
  });

export const lengthFitScorer = createScorer<SectionRun["input"], SectionRun["output"]>({
  id: "length-fit",
  description: "How well a section's length fits its tier's word band (1 inside it).",
})
  .preprocess(({ run }) => ({ words: wordCount(run.output.text), tier: run.input?.lengthTier ?? "medium" }))
  .generateScore(({ results }) => lengthFit(results.preprocessStepResult.words, results.preprocessStepResult.tier))
  .generateReason(({ results }) => `${results.preprocessStepResult.words} words for a ${results.preprocessStepResult.tier} section.`);

export const houseStyle = createScorer<SectionRun["input"], SectionRun["output"]>({
  id: "house-style",
  description: "The paper's house rules: no \"the user\", no naming the material or the section kind, no echoed heading, no markup, no worked-out intervals.",
})
  // An object, not the bare list: Mastra stores each step's result as a record.
  .preprocess(({ run }) => ({ breaches: styleBreaches(run.output.text) }))
  .generateScore(({ results }) => Math.max(0, 1 - 0.25 * results.preprocessStepResult.breaches.length))
  .generateReason(({ results }) => {
    const { breaches } = results.preprocessStepResult;
    return breaches.length === 0 ? "Keeps every house rule." : `Breaks: ${breaches.join("; ")}.`;
  });

export const outlineClean = createScorer<unknown, { notes: string[]; sections: unknown[] }>({
  id: "outline-clean",
  description: "How little the review had to fix in the outline editor's plan: 1 with no fixes, lower with each.",
})
  .generateScore(({ run }) => 1 / (1 + run.output.notes.length))
  .generateReason(({ run }) => (run.output.notes.length === 0 ? `${run.output.sections.length} sections, nothing to fix.` : `Fixed: ${run.output.notes.join("; ")}.`));

const isLocal = process.env.NODE_ENV !== "production";
const always = { type: "ratio" as const, rate: 1 };

/** The `write-section` step's scorers (none in production). */
export const sectionScorers = (): MastraScorers =>
  isLocal
    ? {
        figuresGrounded: { scorer: figuresGrounded, sampling: always },
        reposGrounded: { scorer: reposGrounded, sampling: always },
        lengthFit: { scorer: lengthFitScorer, sampling: always },
        houseStyle: { scorer: houseStyle, sampling: always },
      }
    : {};

/** The `review` step's scorers (none in production). */
export const reviewScorers = (): MastraScorers => (isLocal ? { outlineClean: { scorer: outlineClean, sampling: always } } : {});

/** Every scorer, registered on the Mastra instance so Studio lists them. */
export const allScorers = { figuresGrounded, reposGrounded, lengthFit: lengthFitScorer, houseStyle, outlineClean };
