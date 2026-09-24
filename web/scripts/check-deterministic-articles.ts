/**
 * Runnable self-check for the deterministic stars/numbers articles.
 * `npx tsx scripts/check-deterministic-articles.ts`.
 */
import assert from "node:assert/strict";
import { buildStarsArticle, buildByTheNumbersArticle } from "../src/lib/generation/deterministic-articles";
import { parseArticleChartSpec } from "../src/lib/article-chart";
import type { ActivityItem } from "../src/lib/sources/types";

function activity(overrides: Partial<ActivityItem>): ActivityItem {
  return { source: "github", eventType: "commit", repo: "octocat/demo", title: "t", url: null, timestamp: null, raw: null, ...overrides };
}

// No stars -> null.
assert.equal(buildStarsArticle([activity({ eventType: "commit" })]), null);

// Stars present -> one line per star, using the item's own title.
{
  const article = buildStarsArticle([
    activity({ eventType: "star", title: "octocat/demo — a demo repo" }),
    activity({ eventType: "star", title: "octocat/other" }),
  ]);
  assert.ok(article);
  assert.equal(article!.content, "- octocat/demo — a demo repo\n- octocat/other");
}

// No activity -> null.
assert.equal(buildByTheNumbersArticle([]), null);

// No timestamps -> null (nothing to bucket by day).
assert.equal(buildByTheNumbersArticle([activity({ timestamp: null })]), null);

// Activity spanning two UTC days -> chart labels/data line up, busiest day fact matches.
{
  const day1 = new Date("2026-09-10T12:00:00Z");
  const day2 = new Date("2026-09-11T09:00:00Z");
  const article = buildByTheNumbersArticle([
    activity({ timestamp: day1 }),
    activity({ timestamp: day1 }),
    activity({ timestamp: day1 }),
    activity({ timestamp: day2 }),
  ]);
  assert.ok(article);
  assert.match(article!.deck, /4 events recorded; the busiest day was 2026-09-10 with 3\./);

  const chartMatch = article!.content.match(/```chart\n([\s\S]+?)\n```/);
  assert.ok(chartMatch);
  const spec = parseArticleChartSpec(chartMatch![1]);
  assert.ok(spec);
  assert.deepEqual(spec!.labels, ["2026-09-10", "2026-09-11"]);
  assert.deepEqual(spec!.datasets[0].data, [3, 1]);
}

console.log("deterministic-articles self-check: OK");
