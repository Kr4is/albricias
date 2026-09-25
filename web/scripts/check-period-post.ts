/**
 * Runnable self-check for the leading-heading filter — the one piece of
 * non-trivial logic in `period-post.ts` with no LLM call to exercise it.
 * `npx tsx scripts/check-period-post.ts`.
 */
import assert from "node:assert/strict";
import { createLeadingHeadingFilter } from "../src/lib/generation/period-post";

// Drops an echoed heading from a stream, however it's chunked.
{
  const run = (chunks: string[]) => {
    const filter = createLeadingHeadingFilter();
    return chunks.map((c) => filter.push(c)).join("") + filter.flush();
  };
  assert.equal(run(["## The Par", "ser\n\nIt was", " a week."]), "It was a week.");
  assert.equal(run(["# Title\nBody"]), "Body");
  assert.equal(run(["\n\n**The Month’s ", "Rhythm**\n\nThe month ran."]), "The month ran.");
  assert.equal(run(["__Title__\nBody"]), "Body");
  assert.equal(run(["**Bold** start of a paragraph.\n\nMore."]), "**Bold** start of a paragraph.\n\nMore.");
  assert.equal(run(["It was ", "a week.\n\nMore."]), "It was a week.\n\nMore.");
  assert.equal(run(["#hashtag is not a heading"]), "#hashtag is not a heading");
  assert.equal(run(["## Only a heading"]), "");
  assert.equal(run(["x".repeat(250), " tail"]), "x".repeat(250) + " tail");
}

console.log("period-post self-check: OK");
