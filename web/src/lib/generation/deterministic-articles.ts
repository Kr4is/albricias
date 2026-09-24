/**
 * Two front-page elements computed directly from fetched GitHub activity,
 * with no LLM involved — so they can never hallucinate a number. Modeled as
 * ordinary `IssueArticle`s (not new layout slots) so every `IssueV*` layout
 * renders them for free.
 */

import type { ArticleChartSpec } from "@/lib/article-chart";
import type { ActivityItem } from "@/lib/sources/types";
import type { IssueArticle } from "@/components/issue/types";

/** Sentinel ids distinct from sections' `index`-based ids (0, 1, 2, ...). */
export const STARS_ARTICLE_ID = -1;
export const NUMBERS_ARTICLE_ID = -2;

/** A boxed list of repositories starred during the period, or `null` if none were. */
export function buildStarsArticle(activity: ActivityItem[]): IssueArticle | null {
  const stars = activity.filter((item) => item.eventType === "star");
  if (stars.length === 0) return null;
  return {
    id: STARS_ARTICLE_ID,
    title: "On the Shelves",
    category: "Miscellany",
    author: null,
    deck: "Repositories starred this period.",
    content: stars.map((item) => `- ${item.title}`).join("\n"),
  };
}

/** One honest fact plus a per-day activity chart, or `null` with nothing timestamped to plot. */
export function buildByTheNumbersArticle(activity: ActivityItem[]): IssueArticle | null {
  if (activity.length === 0) return null;

  const perDay = new Map<string, number>();
  for (const item of activity) {
    if (!item.timestamp) continue;
    const key = item.timestamp.toISOString().slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  if (perDay.size === 0) return null;

  const labels = [...perDay.keys()].sort();
  const data = labels.map((key) => perDay.get(key)!);
  const busiest = data.indexOf(Math.max(...data));
  const fact = `${activity.length} events recorded; the busiest day was ${labels[busiest]} with ${data[busiest]}.`;

  const spec: ArticleChartSpec = { type: "bar", title: "Activity by day", labels, datasets: [{ label: "Events", data }] };
  const content = `${fact}\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n`;

  return { id: NUMBERS_ARTICLE_ID, title: "By the Numbers", category: "Almanac", author: null, deck: fact, content };
}
