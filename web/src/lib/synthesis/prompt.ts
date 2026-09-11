/**
 * The compendium's user-role prompt.
 *
 * Follows the shape every other single-call generator in this codebase uses
 * (`@/lib/rankings/calendar.ts:152-177` is the closest sibling): state the
 * commission, lay the material out as labelled bullets, then close with the
 * H1-headline convention `parseResponse` expects and an explicit refusal to
 * fabricate. The grounding instruction is deliberately stated twice — once in
 * `SYNTHESIS_SYSTEM` and once here, at the end of the prompt, next to the very
 * material it governs — because this is the one article whose entire value is
 * that every figure in it can be traced back to the digest above it.
 */

import type { DigestCandidate, DigestItem, EditionDigest } from "./digest";

function itemLines(items: DigestItem[]): string {
  return items.map((item) => `- [${item.category}] "${item.title}" — ${item.excerpt}`).join("\n");
}

function candidateLines(candidates: DigestCandidate[]): string {
  return candidates
    .map((candidate) => {
      const repos = candidate.repos.length > 0 ? ` (${candidate.repos.join(", ")})` : "";
      return `- "${candidate.title}"${repos}: ${candidate.bullets.join("; ")}`;
    })
    .join("\n");
}

/** A section is omitted entirely when empty — an empty heading reads as an absence of data
 * the model might try to fill, whereas a missing section simply is not part of the month. */
function section(heading: string, body: string): string {
  return body ? `${heading}\n${body}\n\n` : "";
}

/**
 * Build the compendium prompt from `digest` for the `periodLabel` edition.
 *
 * Pure and deterministic: the prompt is stored alongside the digest in the
 * article's `sourceData`, so the exact text the model saw is recoverable
 * afterwards.
 */
export function buildSynthesisPrompt(digest: EditionDigest, periodLabel: string): string {
  const numbers = digest.numbers.map((n) => `- ${n.label}: ${n.value}`).join("\n");

  return (
    `Write the front-page Monthly Compendium for the ${periodLabel} edition of ` +
    `¡Albricias! — the editorial that opens the issue and accounts for the whole ` +
    `period at once.\n\n` +
    `Everything below has already been written or measured for this edition. It ` +
    `is the complete record available to you: read across all of it, find the ` +
    `threads that connect separate items, and tell the reader what kind of ` +
    `period this was. Name the specific articles, repositories, works and ` +
    `figures you are drawing on, and quote the numbers exactly as they appear ` +
    `below.\n\n` +
    section("Dispatches from each source:", itemLines(digest.chronicle)) +
    section("Rankings and almanacs:", itemLines(digest.rankings)) +
    section("Commissioned pieces:", itemLines(digest.features)) +
    section("Story angles the editor marked as worth telling:", candidateLines(digest.topicCandidates)) +
    section("Figures for the period:", numbers) +
    `Give the piece a compelling headline (as a markdown H1), then the body ` +
    `text. Do not include a byline or date — those are added separately. Write ` +
    `between 400 and 700 words.\n\n` +
    `Do not invent facts beyond what is given above. Every repository name, ` +
    `article title, work, person and numeric figure in your piece must appear ` +
    `in the material above — do not fabricate numbers, do not embellish the ` +
    `ones given, and do not infer causes, motives, or outcomes the material ` +
    `does not state. If a source was silent or the period was quiet, say so ` +
    `plainly rather than filling the space.`
  );
}
