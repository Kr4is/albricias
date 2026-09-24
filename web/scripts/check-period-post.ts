/**
 * Runnable self-check for `parseOutline`'s hand-rolled text parser — the
 * one piece of non-trivial logic in `period-post.ts` with no LLM call to
 * exercise it. `npx tsx scripts/check-period-post.ts`.
 */
import assert from "node:assert/strict";
import { createLeadingHeadingFilter, parseOutline } from "../src/lib/generation/period-post";

// Well-formed reply, all three LENGTH tiers present.
{
  const raw = [
    "# A Quiet Week of Fixes",
    "",
    "PREMISE: A steady week of bugfixes across two repositories.",
    "",
    "## The Parser Finally Behaves",
    "BRIEF: Several bugfix commits landed in demo-repo.",
    "LENGTH: long",
    "",
    "## A Passing Star",
    "BRIEF: One repository was starred.",
    "LENGTH: short",
  ].join("\n");
  const outline = parseOutline(raw);
  assert.equal(outline.title, "A Quiet Week of Fixes");
  assert.equal(outline.sections.length, 2);
  assert.equal(outline.sections[0].lengthTier, "long");
  assert.equal(outline.sections[1].lengthTier, "short");
}

// Missing LENGTH line defaults to "medium".
{
  const raw = "# Title\nPREMISE: p\n\n## Heading\nBRIEF: brief only, no length line";
  const outline = parseOutline(raw);
  assert.equal(outline.sections[0].lengthTier, "medium");
}

// Malformed reply (no "## " sections at all) — zero sections, caller (buildOutline) falls back.
{
  const outline = parseOutline("Just some unstructured prose with no headings.");
  assert.equal(outline.sections.length, 0);
}


// Leading-heading filter: drops an echoed heading from a stream, however it's chunked.
{
  const run = (chunks: string[]) => {
    const filter = createLeadingHeadingFilter();
    return chunks.map((c) => filter.push(c)).join("") + filter.flush();
  };
  assert.equal(run(["## The Par", "ser\n\nIt was", " a week."]), "It was a week.");
  assert.equal(run(["# Title\nBody"]), "Body");
  assert.equal(run(["It was ", "a week.\n\nMore."]), "It was a week.\n\nMore.");
  assert.equal(run(["#hashtag is not a heading"]), "#hashtag is not a heading");
  assert.equal(run(["## Only a heading"]), "");
  assert.equal(run(["x".repeat(250), " tail"]), "x".repeat(250) + " tail");
}

console.log("period-post self-check: OK");
