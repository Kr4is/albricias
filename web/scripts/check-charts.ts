/**
 * Runnable self-check for the chart desk and the computed boxes
 * (`@/lib/generation/charts`). `npx tsx scripts/check-charts.ts`.
 */
import assert from "node:assert/strict";
import { buildDossier } from "../src/lib/generation/dossier";
import { chartsForSection, numbersBox, starsBox } from "../src/lib/generation/charts";
import type { ReviewedSection } from "../src/lib/generation/outline";
import type { RepoDetails } from "../src/lib/sources/github";
import type { ActivityItem } from "../src/lib/sources/types";

function commit(repo: string, day: number, hour: number, message: string): ActivityItem {
  const local = `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:10:00.000+02:00`;
  return { source: "github", eventType: "commit", repo, title: message, url: null, timestamp: new Date(local), raw: { commit: { message, author: { date: local } } } };
}
function star(repo: string, day: number): ActivityItem {
  return { source: "github", eventType: "star", repo, title: repo, url: null, timestamp: new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`), raw: null };
}
const details = (name: string, stars: number): [string, RepoDetails] => [
  name.toLowerCase(),
  { fullName: name, description: `About ${name}`, language: "Go", stars, forks: 1, topics: ["a", "b"], isFork: false, archived: false, url: null, homepage: null },
];

const kinds = ["feat", "fix", "feat", "docs", "ci", "feat", "fix", "refactor", "chore"];
const activity: ActivityItem[] = [
  ...Array.from({ length: 27 }, (_, i) => commit("me/big", 6 + (i % 9), 9 + (i % 10), `${kinds[i % kinds.length]}: step ${i}`)),
  ...Array.from({ length: 8 }, (_, i) => commit("me/big", 21, 14 + (i % 5), `feat: busy day ${i}`)),
  commit("me/small", 15, 10, "ci: images"),
  commit("me/small", 15, 11, "fix: tests"),
  commit("friend/lib", 19, 20, "feat: landing"),
  star("a/huge", 5), star("b/mid", 7), star("c/tiny", 9), star("d/none", 10),
];
const dossier = buildDossier(activity, new Map([details("a/huge", 108_000), details("b/mid", 6_800), details("c/tiny", 205)]), {
  username: "me",
  periodLabel: "September 2026",
  cadence: "monthly",
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-10-01T00:00:00Z"),
});
const section = (s: Partial<ReviewedSection> & Pick<ReviewedSection, "kind">): ReviewedSection => ({ heading: "h", brief: "b", lengthTier: "long", repos: [], window: null, ...s });
const total = (chart: { datasets: { data: number[] }[] }) => chart.datasets.reduce((sum, d) => sum + d.data.reduce((a, b) => a + b, 0), 0);

// Overview: a 24-hour rose of every commit, plus the arc for a long one.
{
  const [rose, arc] = chartsForSection(dossier, section({ kind: "overview" }));
  assert.equal(rose.type, "polarArea");
  assert.equal(rose.labels.length, 24);
  assert.equal(total(rose), 38);
  assert.equal(arc.type, "line");
  assert.equal(chartsForSection(dossier, section({ kind: "overview", lengthTier: "medium" })).length, 1);
  assert.equal(chartsForSection(dossier, section({ kind: "overview", lengthTier: "short" })).length, 0);
}

// Feature: its window, day by day, stacked by kind — every commit counted once; one day goes hour by hour.
{
  const [course] = chartsForSection(dossier, section({ kind: "feature", repos: ["me/big"], window: { from: "2026-09-06", to: "2026-09-14" } }));
  assert.equal(course.type, "bar");
  assert.equal(course.stacked, true);
  assert.equal(course.labels.length, 9);
  assert.equal(total(course), 27);
  assert.ok(course.datasets.some((d) => d.label === "Features"));
  const [day] = chartsForSection(dossier, section({ kind: "feature", repos: ["me/big"], window: { from: "2026-09-21", to: "2026-09-21" } }));
  assert.match(day.title, /hour by hour/);
  assert.deepEqual(day.labels, ["14h", "15h", "16h", "17h", "18h"]);
  assert.equal(total(day), 8);
  // Three features on one repo: three different shapes, then none.
  const used = new Set<string>();
  const feature = section({ kind: "feature", repos: ["me/big"], window: { from: "2026-09-06", to: "2026-09-21" } });
  const shapes = [0, 1, 2, 3].map(() => chartsForSection(dossier, feature, used)[0]);
  assert.deepEqual(shapes.slice(0, 3).map((c) => [c.type, c.title.split(", ").pop()]), [["bar", "day by day"], ["bar", "by hour of day"], ["line", "commit by commit"]]);
  assert.equal(shapes[3], undefined);
  assert.equal(total({ datasets: [{ data: [shapes[2].datasets[0].data.at(-1)!] }] }), 35);
  // Too little to chart.
  assert.equal(chartsForSection(dossier, section({ kind: "feature", repos: ["me/small"] })).length, 0);
}

// Round-up: repos side by side; reading list: star counts on a log scale, the unknown left out.
{
  const [compare] = chartsForSection(dossier, section({ kind: "roundup", repos: ["me/small", "friend/lib"] }));
  assert.equal(compare.horizontal, true);
  assert.deepEqual(compare.labels, ["me/small", "friend/lib"]);
  assert.equal(total(compare), 3);
  const [sizes] = chartsForSection(dossier, section({ kind: "reading-list", repos: ["c/tiny"] }));
  assert.deepEqual(sizes.labels, ["huge", "mid", "tiny"]);
  assert.equal(sizes.logScale, true);
}

// The boxes, as data: facts and the mix (the arc too without an overview); one card per star, best known first.
{
  const numbers = numbersBox(dossier, new Set(["arc"]))!;
  const facts = numbers.blocks[0];
  assert.equal(facts.type, "facts");
  assert.deepEqual(facts.type === "facts" && facts.items.find((f) => f.label === "Commits"), { label: "Commits", value: "38" });
  assert.deepEqual(numbers.blocks.map((b) => (b.type === "chart" ? b.chart.type : b.type)), ["facts", "doughnut"]);
  assert.deepEqual(numbersBox(dossier)!.blocks.map((b) => (b.type === "chart" ? b.chart.type : b.type)), ["facts", "doughnut", "line"]);
  const mix = numbers.blocks[1];
  assert.equal(mix.type === "chart" && total(mix.chart), 38);

  const stars = starsBox(dossier)!;
  const cards = stars.blocks[0];
  assert.equal(cards.type, "repos");
  assert.deepEqual(cards.type === "repos" && cards.items.map((c) => [c.name, c.stars]), [["a/huge", 108_000], ["b/mid", 6_800], ["c/tiny", 205], ["d/none", null]]);
  assert.equal(cards.type === "repos" && cards.items[0].url, "https://github.com/a/huge");
  assert.deepEqual(stars.order, ["a/huge", "b/mid", "c/tiny", "d/none"]);
}

console.log("charts self-check: OK");
