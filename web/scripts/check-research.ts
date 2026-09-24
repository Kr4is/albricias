/**
 * Runnable self-check for the research dossier.
 * `npx tsx scripts/check-research.ts`.
 */
import assert from "node:assert/strict";
import { researchPeriod } from "../src/lib/generation/research";
import type { RepoDetails } from "../src/lib/sources/github";
import type { ActivityItem } from "../src/lib/sources/types";

function activity(overrides: Partial<ActivityItem>): ActivityItem {
  return { source: "github", eventType: "commit", repo: "me/app", title: "t", url: null, timestamp: new Date("2026-09-10T12:00:00Z"), raw: null, ...overrides };
}

const items = [
  activity({ title: "Add parser", raw: { commit: { message: "Add parser\n\nHandles nested lists and tables." } } }),
  activity({ eventType: "pr", title: "Parser v2", raw: { state: "closed", pull_request: { merged_at: "2026-09-10T13:00:00Z" }, body: "Rewrites the **parser**.", comments: 2 } }),
  activity({ eventType: "release", title: "v1.0", raw: { tag_name: "v1.0", body: "First stable release." } }),
  activity({ eventType: "issue", repo: "other/lib", title: "Crash on empty input", raw: { state: "open", labels: [{ name: "bug" }] } }),
  activity({ eventType: "star", repo: "acme/tool", title: "acme/tool" }),
];
const details = new Map<string, RepoDetails>([
  ["me/app", { fullName: "me/app", description: "A markdown app", language: "TypeScript", stars: 12, forks: 0, topics: ["markdown"], isFork: false, archived: false, url: null }],
  ["acme/tool", { fullName: "acme/tool", description: "A CLI for everything", language: "Go", stars: 5400, forks: 300, topics: [], isFork: false, archived: false, url: null }],
]);

const research = researchPeriod(items, details);

// The whole dossier: what each repo is, and what the period did in it.
assert.match(research.text, /### me\/app — A markdown app — TypeScript, ★ 12, topics: markdown/);
assert.match(research.text, /"Add parser" — Handles nested lists and tables\./);
assert.match(research.text, /"Parser v2" \[merged, 2 comments, Sep 10\] — Rewrites the parser\./);
assert.match(research.text, /v1\.0, Sep 10 — notes: First stable release\./);
assert.match(research.text, /"Crash on empty input" \[open, labels: bug, Sep 10\]/);
assert.match(research.text, /## Starred this period[\s\S]*- acme\/tool — A CLI for everything — Go, ★ 5\.4k, 300 forks/);
assert.match(research.text, /Languages of the repositories worked in \(by events\): TypeScript 3\./);

// Narrowed to one repo: its dossier and an index of the rest, not the others' detail.
const focused = research.forRepo("ME/APP");
assert.match(focused, /### me\/app/);
assert.doesNotMatch(focused, /Crash on empty input/);
assert.match(focused, /## Elsewhere this period\n- other\/lib: 1 issue opened\n- starred acme\/tool/);

// A starred repo in focus: its starred entry, not a work dossier.
assert.match(research.forRepo("acme/tool"), /## Starred this period\n- acme\/tool — A CLI for everything/);

// A repo the period never mentions: the whole dossier.
assert.equal(research.forRepo("nobody/nothing"), research.text);

// Nothing at all -> refuses.
assert.throws(() => researchPeriod([]));

console.log("research self-check: OK");
