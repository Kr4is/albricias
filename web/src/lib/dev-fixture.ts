/**
 * Deterministic made-up articles for `/dev/layouts` — a page to look at, and
 * measure (`scripts/check-layouts.ts`), every layout at every article count
 * without generating an edition. Lengths vary the way real sections do: a
 * long lead, then short and long ones mixed, some with a facts box.
 */

import type { IssueArticle } from "@/components/issue/types";

const SENTENCES = [
  "The week opened with a quiet refactor that grew teeth by Wednesday.",
  "Commits arrived in bursts, mostly after dark, each one smaller than the last.",
  "A long-awaited release finally left the dock, trailing a wake of fixed bugs.",
  "Reviewers were seen pacing the corridors of the pull request queue.",
  "By Friday the test suite, once sluggish, ran in a third of its former time.",
  "Nobody could say for certain what the migration had cost, only that it was paid.",
  "The parser, long neglected, was given a new grammar and a stern talking-to.",
  "A single dependency bump set off a chain of events best left to the changelog.",
];

const CATEGORIES = ["Engineering", "Releases", "Open Source", "Tooling", "Review", "Notes", "Dispatch", "Briefs"];
const TITLES = [
  "The Parser Rebuilt",
  "Tests Run in Third of Time",
  "A Release Leaves the Dock",
  "Reviewers Pace the Queue",
  "Migration Concludes Quietly",
  "Dependency Bump Stirs Trouble",
  "Late-Night Commits Rise",
  "Stars Gather Over New Project",
  "Docs Catch Up With Code",
];

/** Paragraph `i` of `sentences` sentences, rotating through the stock lines. */
function paragraph(seed: number, sentences: number): string {
  return Array.from({ length: sentences }, (_, k) => SENTENCES[(seed + k * 3) % SENTENCES.length]).join(" ");
}

/**
 * `count` articles: id 0 is the lead; ids ≥ 1 vary in length. With `charts`,
 * every third article carries a chart — an unsplittable block, so a column
 * flow can end up to a chart's height short of its neighbour (which
 * `scripts/check-layouts.ts` would call a hole); off by default for that reason.
 */
export function fixtureArticles(count: number, charts = false): IssueArticle[] {
  return Array.from({ length: count }, (_, i) => {
    const paragraphs = i === 0 ? 5 : [1, 3, 2, 4, 1, 2, 3, 2][(i - 1) % 8];
    const content = Array.from({ length: paragraphs }, (_, p) => paragraph(i * 5 + p, i === 0 ? 5 : 3 + ((i + p) % 3))).join("\n\n");
    return {
      id: i,
      title: TITLES[i % TITLES.length],
      category: CATEGORIES[i % CATEGORIES.length],
      author: i % 2 === 0 ? "By Our Correspondent" : null,
      deck: "",
      content,
      image: null,
      blocks:
        i % 3 === 1
          ? [{ type: "facts", items: [{ label: "Commits", value: "41" }, { label: "Active days", value: "9 of 30" }] }]
          : charts && i % 3 === 2
            ? [{ type: "chart", chart: { type: "bar", title: "Commits by day", labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], datasets: [{ label: "Commits", data: [4, 9, 6, 12, 3] }], unit: "commits", caption: "Made-up numbers." } }]
            : [],
    };
  });
}
