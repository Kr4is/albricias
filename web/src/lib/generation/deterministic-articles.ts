/**
 * Two front-page elements computed directly from fetched GitHub activity,
 * with no LLM involved — so they can never hallucinate a number. Modeled as
 * ordinary `IssueArticle`s (not new layout slots) so every `IssueV*` layout
 * renders them for free.
 */

import type { ArticleChartSpec } from "@/lib/article-chart";
import { repoImageUrl } from "@/lib/repo-image";
import type { RepoDetails } from "@/lib/sources/github";
import type { ActivityItem } from "@/lib/sources/types";
import type { IssueArticle } from "@/components/issue/types";
import { describeRepo } from "@/lib/generation/research";

/** Sentinel ids distinct from sections' `index`-based ids (0, 1, 2, ...). */
export const STARS_ARTICLE_ID = -1;
export const NUMBERS_ARTICLE_ID = -2;

/** Starred repos listed in the box at most — the rest are counted, not dropped silently. */
const MAX_STARS_SHOWN = 12;

/**
 * A boxed list of the repositories starred during the period — each with
 * what it is (description, language, stars) — pictured with the most
 * popular one's card. `null` if none were starred. `pictured` is the set
 * of repos already shown elsewhere on the page, so a card never repeats.
 */
export function buildStarsArticle(
  activity: ActivityItem[],
  details: Map<string, RepoDetails>,
  pictured: Set<string> = new Set(),
): IssueArticle | null {
  const stars = activity.filter((item) => item.eventType === "star" && item.repo);
  if (stars.length === 0) return null;

  const entries = stars.map((item) => ({ item, details: details.get(item.repo!.toLowerCase()) }));
  const lines = entries.slice(0, MAX_STARS_SHOWN).map(({ item, details: d }) => {
    const link = item.url ? `[${item.repo}](${item.url})` : item.repo;
    const facts = describeRepo(d ? { ...d, topics: [] } : undefined);
    return `- **${link}**${d?.description ? ` — ${d.description}` : ""}${facts ? ` *(${facts})*` : ""}`;
  });
  if (stars.length > MAX_STARS_SHOWN) lines.push(`- …and ${stars.length - MAX_STARS_SHOWN} more.`);

  const popular = [...entries]
    .filter(({ item }) => !pictured.has(item.repo!))
    .sort((a, b) => (b.details?.stars ?? -1) - (a.details?.stars ?? -1))[0];

  return {
    id: STARS_ARTICLE_ID,
    title: "On the Shelves",
    category: "Miscellany",
    author: null,
    deck: `${stars.length} ${stars.length === 1 ? "repository" : "repositories"} starred this period.`,
    content: lines.join("\n"),
    imageUrl: popular ? repoImageUrl(popular.item.repo!) : null,
  };
}

const KIND_NAMES: Record<string, string> = {
  commit: "Commits",
  pr: "PRs opened",
  review: "Reviews",
  issue: "Issues",
  release: "Releases",
  repo_created: "New repos",
  star: "Stars",
  gist: "Gists",
};

/** Plain facts plus two charts — events by kind, and by day — or `null` with nothing to count. */
export function buildByTheNumbersArticle(activity: ActivityItem[]): IssueArticle | null {
  if (activity.length === 0) return null;

  const perKind = new Map<string, number>();
  for (const item of activity) perKind.set(item.eventType, (perKind.get(item.eventType) ?? 0) + 1);
  const kinds = [...perKind.entries()].sort((a, b) => b[1] - a[1]);

  const perDay = new Map<string, number>();
  for (const item of activity) {
    if (!item.timestamp) continue;
    const key = item.timestamp.toISOString().slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const repos = new Set(activity.filter((item) => item.eventType !== "star" && item.repo).map((item) => item.repo)).size;
  const merged = activity.filter(
    (item) => item.eventType === "pr" && Boolean(((item.raw ?? {}) as { pull_request?: { merged_at?: string | null } }).pull_request?.merged_at),
  ).length;
  const prs = perKind.get("pr") ?? 0;

  const facts = [
    `${activity.length} ${activity.length === 1 ? "event" : "events"} recorded${repos ? ` across ${repos} ${repos === 1 ? "repository" : "repositories"}` : ""}.`,
    prs ? `${prs} pull ${prs === 1 ? "request" : "requests"} opened, ${merged} merged.` : "",
  ].filter(Boolean);

  const charts: ArticleChartSpec[] = [];
  if (kinds.length > 1) {
    charts.push({ type: "bar", title: "Events by kind", labels: kinds.map(([k]) => KIND_NAMES[k] ?? k), datasets: [{ label: "Events", data: kinds.map(([, n]) => n) }] });
  }
  if (perDay.size > 0) {
    const labels = [...perDay.keys()].sort();
    const data = labels.map((key) => perDay.get(key)!);
    const busiest = data.indexOf(Math.max(...data));
    facts.push(`The busiest day was ${labels[busiest]} with ${data[busiest]}.`);
    charts.push({ type: "bar", title: "Activity by day", labels, datasets: [{ label: "Events", data }] });
  }

  const content = [facts.join(" "), ...charts.map((spec) => `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``)].join("\n\n") + "\n";
  return { id: NUMBERS_ARTICLE_ID, title: "By the Numbers", category: "Almanac", author: null, deck: facts[0], content };
}
