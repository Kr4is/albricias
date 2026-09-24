/**
 * Runnable self-check for the deterministic stars/numbers articles.
 * `npx tsx scripts/check-deterministic-articles.ts`.
 */
import assert from "node:assert/strict";
import { buildStarsArticle, buildByTheNumbersArticle, starImageCandidates } from "../src/lib/generation/deterministic-articles";
import { parseArticleChartSpec } from "../src/lib/article-chart";
import type { RepoDetails } from "../src/lib/sources/github";
import type { ActivityItem } from "../src/lib/sources/types";

function activity(overrides: Partial<ActivityItem>): ActivityItem {
  return { source: "github", eventType: "commit", repo: "octocat/demo", title: "t", url: null, timestamp: null, raw: null, ...overrides };
}

function details(fullName: string, overrides: Partial<RepoDetails> = {}): [string, RepoDetails] {
  return [
    fullName.toLowerCase(),
    { fullName, description: null, language: null, stars: null, forks: null, topics: [], isFork: false, archived: false, url: null, ...overrides },
  ];
}

// No stars -> null.
assert.equal(buildStarsArticle([activity({ eventType: "commit" })], new Map()), null);

// Stars -> one line per star with what the repo is; picture candidates most-starred first.
{
  const stars = [
    activity({ eventType: "star", repo: "acme/small", url: "https://github.com/acme/small" }),
    activity({ eventType: "star", repo: "acme/big" }),
    activity({ eventType: "star", repo: "acme/biggest" }),
  ];
  const known = new Map([
    details("acme/small", { description: "A small tool", language: "Rust", stars: 40 }),
    details("acme/big", { stars: 1200 }),
    details("acme/biggest", { stars: 90_000 }),
  ]);
  const article = buildStarsArticle(stars, known);
  assert.ok(article);
  const lines = article!.content.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "- **[acme/small](https://github.com/acme/small)** — A small tool *(Rust, ★ 40)*");
  assert.equal(lines[1], "- **acme/big** *(★ 1.2k)*");
  assert.equal(article!.imageUrl, null);
  assert.deepEqual(starImageCandidates(stars, known), ["acme/biggest", "acme/big", "acme/small"]);
  assert.equal(article!.deck, "3 repositories starred this period.");
}

// No activity -> null.
assert.equal(buildByTheNumbersArticle([]), null);

// Two kinds over two UTC days -> a by-kind chart and a by-day chart, facts that match.
{
  const day1 = new Date("2026-09-10T12:00:00Z");
  const day2 = new Date("2026-09-11T09:00:00Z");
  const article = buildByTheNumbersArticle([
    activity({ timestamp: day1 }),
    activity({ timestamp: day1 }),
    activity({ timestamp: day1, eventType: "pr", raw: { pull_request: { merged_at: "2026-09-10T13:00:00Z" } } }),
    activity({ timestamp: day2, eventType: "star", repo: "acme/big" }),
  ]);
  assert.ok(article);
  assert.equal(article!.deck, "4 events recorded across 1 repository.");
  assert.match(article!.content, /1 pull request opened, 1 merged\./);
  assert.match(article!.content, /The busiest day was 2026-09-10 with 3\./);

  const charts = [...article!.content.matchAll(/```chart\n([\s\S]+?)\n```/g)].map((m) => parseArticleChartSpec(m[1]));
  assert.equal(charts.length, 2);
  assert.deepEqual(charts[0]!.labels, ["Commits", "PRs opened", "Stars"]);
  assert.deepEqual(charts[0]!.datasets[0].data, [2, 1, 1]);
  assert.deepEqual(charts[1]!.labels, ["2026-09-10", "2026-09-11"]);
  assert.deepEqual(charts[1]!.datasets[0].data, [3, 1]);
}

console.log("deterministic-articles self-check: OK");
