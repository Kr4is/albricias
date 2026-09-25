/**
 * The chart desk: every chart on the page, computed from the dossier — no
 * model draws one, so none can show a figure the period didn't record —
 * and chosen for what each section is about:
 *
 *   overview      the working day as a 24-hour rose, and the period's arc
 *                 week by week (or day by day)
 *   feature       its repository's commits day by day over its window,
 *                 stacked by kind of work (hour by hour for a single day)
 *   roundup       its repositories side by side, stacked by kind of work
 *   reading-list  how big the starred projects are (log scale — they
 *                 range from a few hundred stars to a hundred thousand)
 *
 * A section only gets a chart when its data has a shape worth seeing
 * (enough commits, more than one day, more than one repo); a short one
 * never does. Plus the two computed boxes, as structured blocks: the
 * numbers (facts and the mix of work) and the stars (one card each).
 * Pure — the workflow's `illustrate` step runs it.
 */

import type { ArticleBlock, ChartSpec, Fact, RepoCard } from "@/lib/article-blocks";
import type { Dossier } from "@/lib/generation/dossier";
import type { ReviewedSection } from "@/lib/generation/outline";

/** Commit kinds charted on their own; the rest are "other". */
const TOP_KINDS = 3;
/** Fewest commits a feature needs for a chart of them. */
const MIN_CHART_COMMITS = 6;
/** Stars listed in the stars box at most. */
const MAX_STAR_CARDS = 12;

const KIND_LABELS: Record<string, string> = {
  feat: "Features",
  fix: "Fixes",
  refactor: "Refactors",
  docs: "Docs",
  ci: "CI",
  chore: "Chores",
  style: "Style",
  test: "Tests",
  perf: "Performance",
  build: "Build",
  merge: "Merges",
  other: "Other",
};
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

type Commit = Dossier["repos"][number]["commits"][number];

/** The period's commits (optionally one repo's, within a window). */
function commitsOf(dossier: Dossier, repos?: string[], window?: { from: string; to: string } | null): Commit[] {
  return dossier.repos
    .filter((repo) => !repos || repos.includes(repo.name))
    .flatMap((repo) => repo.commits)
    .filter((c) => !window || (c.date >= window.from && c.date <= window.to));
}

/** The most common kinds across `commits`, the rest folded into "other". */
function topKinds(commits: Commit[]): string[] {
  const tally = new Map<string, number>();
  for (const c of commits) tally.set(c.type ?? "other", (tally.get(c.type ?? "other") ?? 0) + 1);
  const ranked = [...tally.entries()].filter(([kind]) => kind !== "other").sort((a, b) => b[1] - a[1]);
  const kept = ranked.slice(0, TOP_KINDS).map(([kind]) => kind);
  return ranked.length > TOP_KINDS || tally.has("other") ? [...kept, "other"] : kept;
}

/** One dataset per kind, over `keys` (days, hours, repos). */
function stackedByKind(commits: Commit[], keys: string[], keyOf: (c: Commit) => string): ChartSpec["datasets"] {
  const kinds = topKinds(commits);
  const kindOf = (c: Commit) => (kinds.includes(c.type ?? "other") ? (c.type ?? "other") : "other");
  return kinds.map((kind) => ({
    label: kindLabel(kind),
    data: keys.map((key) => commits.filter((c) => keyOf(c) === key && kindOf(c) === kind).length),
  }));
}

/** `2026-09-21` → `Sep 21`. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Every day from `from` to `to`, inclusive. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// One chart per shape
// ---------------------------------------------------------------------------

/** Commits by hour of the author's day, as a rose. */
function workingDay(commits: Commit[]): ChartSpec | null {
  const hours = commits.map((c) => c.hour).filter((h): h is number => h !== null);
  if (hours.length < MIN_CHART_COMMITS) return null;
  const data = Array.from({ length: 24 }, (_, h) => hours.filter((x) => x === h).length);
  const peak = data.indexOf(Math.max(...data));
  return {
    type: "polarArea",
    title: "The working day",
    labels: data.map((_, h) => `${String(h).padStart(2, "0")}h`),
    datasets: [{ label: "Commits", data }],
    unit: "commits",
    caption: `Commits by hour, in the author's own time. Busiest: ${String(peak).padStart(2, "0")}:00.`,
  };
}

/** The period's events, bucket by bucket. */
function arc(dossier: Dossier): ChartSpec | null {
  const timeline = dossier.overview.timeline;
  if (timeline.length < 3) return null;
  const weekly = timeline[0]?.bucket.includes("-W");
  return {
    type: "line",
    title: weekly ? "Week by week" : "Day by day",
    labels: timeline.map((b) => (weekly ? `Week ${Number(b.bucket.split("-W")[1])}` : shortDay(b.bucket))),
    datasets: [{ label: "Events", data: timeline.map((b) => b.events) }],
    unit: "events",
    caption: `Everything recorded — commits, pull requests, stars — ${weekly ? "per ISO week" : "per day"}.`,
  };
}

/** A repository's commits over a window, day by day (or hour by hour on one day), stacked by kind. */
function repoCourse(dossier: Dossier, repo: string, window: { from: string; to: string } | null): ChartSpec | null {
  const commits = commitsOf(dossier, [repo], window);
  if (commits.length < MIN_CHART_COMMITS) return null;
  const days = [...new Set(commits.map((c) => c.date))].sort();
  if (days.length === 1) {
    const hours = commits.map((c) => c.hour).filter((h): h is number => h !== null);
    if (hours.length < MIN_CHART_COMMITS) return null;
    const first = Math.min(...hours);
    const keys = Array.from({ length: Math.max(...hours) - first + 1 }, (_, i) => String(first + i));
    return {
      type: "bar",
      title: `${shortDay(days[0])}, hour by hour`,
      labels: keys.map((h) => `${h.padStart(2, "0")}h`),
      datasets: stackedByKind(commits, keys, (c) => String(c.hour)),
      stacked: true,
      unit: "commits",
      caption: `${plural(commits.length, "commit")} to ${repo} in one day.`,
    };
  }
  const keys = daysBetween(days[0], days[days.length - 1]);
  return {
    type: "bar",
    title: window ? `${shortDay(keys[0])} – ${shortDay(keys[keys.length - 1])}` : "Commits, day by day",
    labels: keys.map(shortDay),
    datasets: stackedByKind(commits, keys, (c) => c.date),
    stacked: true,
    unit: "commits",
    caption: `${plural(commits.length, "commit")} to ${repo}, by kind of work.`,
  };
}

/** Several repositories side by side, stacked by kind. */
function repoComparison(dossier: Dossier, repos: string[]): ChartSpec | null {
  const withCommits = repos.filter((name) => commitsOf(dossier, [name]).length > 0);
  if (withCommits.length < 2) return null;
  const commits = commitsOf(dossier, withCommits);
  const repoOf = new Map<Commit, string>();
  for (const repo of dossier.repos) for (const c of repo.commits) repoOf.set(c, repo.name);
  return {
    type: "bar",
    title: "Where the work went",
    labels: withCommits,
    datasets: stackedByKind(commits, withCommits, (c) => repoOf.get(c)!),
    horizontal: true,
    stacked: true,
    unit: "commits",
    caption: `${plural(commits.length, "commit")} across ${withCommits.length} repositories, by kind of work.`,
  };
}

/** How big the starred projects are. */
function starSizes(dossier: Dossier, featured: string[]): ChartSpec | null {
  const stars = dossier.stars
    .filter((star) => star.about?.stars != null)
    .sort((a, b) => Number(featured.includes(b.repo)) - Number(featured.includes(a.repo)) || b.about!.stars! - a.about!.stars!)
    .slice(0, 8)
    .sort((a, b) => b.about!.stars! - a.about!.stars!);
  if (stars.length < 3) return null;
  const values = stars.map((star) => star.about!.stars!);
  return {
    type: "bar",
    title: "How big they are",
    labels: stars.map((star) => star.repo.split("/")[1]),
    datasets: [{ label: "GitHub stars", data: values }],
    horizontal: true,
    logScale: Math.max(...values) / Math.max(1, Math.min(...values)) > 50,
    unit: "stars",
    caption: "Stargazers on GitHub today, on a logarithmic scale.",
  };
}

/** The mix of work, as a doughnut: the five commonest kinds, the rest as "other". */
function workMix(commits: Commit[]): ChartSpec | null {
  if (commits.length < MIN_CHART_COMMITS) return null;
  const tally = new Map<string, number>();
  for (const c of commits) tally.set(c.type ?? "other", (tally.get(c.type ?? "other") ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length < 2) return null;
  const parts: [string, number][] = ranked.filter(([kind]) => kind !== "other").slice(0, 5);
  const other = commits.length - parts.reduce((sum, [, n]) => sum + n, 0);
  if (other > 0) parts.push(["other", other]);
  return {
    type: "doughnut",
    title: "The mix of work",
    labels: parts.map(([kind]) => kindLabel(kind)),
    datasets: [{ label: "Commits", data: parts.map(([, n]) => n) }],
    unit: "commits",
    caption: "Commits by conventional-commit type.",
  };
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

/** The charts for one section (see the header) — none, one, or two for an overview. */
export function chartsForSection(dossier: Dossier, section: ReviewedSection): ChartSpec[] {
  if (section.lengthTier === "short") return [];
  const charts: (ChartSpec | null)[] = [];
  switch (section.kind) {
    case "overview":
      charts.push(workingDay(commitsOf(dossier)), section.lengthTier === "long" ? arc(dossier) : null);
      break;
    case "feature":
      charts.push(repoCourse(dossier, section.repos[0], section.window));
      break;
    case "roundup":
      charts.push(repoComparison(dossier, section.repos));
      break;
    case "reading-list":
      charts.push(starSizes(dossier, section.repos));
      break;
  }
  return charts.filter((chart): chart is ChartSpec => chart !== null);
}

/** The numbers box: the period's facts, the mix of work, and — when no overview section tells it — the arc. */
export function numbersBox(dossier: Dossier, hasOverview: boolean): { deck: string; blocks: ArticleBlock[] } | null {
  const { totals, rhythm } = dossier.overview;
  if (totals.events === 0) return null;
  const facts: Fact[] = [
    { label: "Commits", value: String(totals.commits) },
    { label: "Active days", value: `${rhythm.activeDays} of ${dossier.overview.period.days}` },
    rhythm.longestStreak && rhythm.longestStreak.days > 1 ? { label: "Longest streak", value: plural(rhythm.longestStreak.days, "day"), note: `${shortDay(rhythm.longestStreak.from)} – ${shortDay(rhythm.longestStreak.to)}` } : null,
    rhythm.busiestDay ? { label: "Busiest day", value: shortDay(rhythm.busiestDay.date), note: plural(rhythm.busiestDay.events, "event") } : null,
    totals.pullRequestsOpened ? { label: "Pull requests", value: `${totals.pullRequestsMerged} of ${totals.pullRequestsOpened} merged` } : null,
    totals.releases ? { label: "Releases", value: String(totals.releases) } : null,
    totals.reposCreated ? { label: "New repositories", value: String(totals.reposCreated) } : null,
    totals.starred ? { label: "Stars given", value: String(totals.starred) } : null,
    dossier.overview.languages[0] ? { label: "Main language", value: dossier.overview.languages[0].language } : null,
  ].filter((fact): fact is Fact => fact !== null);
  const blocks: ArticleBlock[] = [{ type: "facts", items: facts }];
  const mix = workMix(commitsOf(dossier));
  if (mix) blocks.push({ type: "chart", chart: mix });
  const course = hasOverview ? null : arc(dossier);
  if (course) blocks.push({ type: "chart", chart: course });
  const repos = dossier.repos.length;
  return { deck: `${plural(totals.events, "event")} recorded across ${plural(repos, "repository", "repositories")}.`, blocks };
}

/** The stars box: one card per starred repository, most popular first. */
export function starsBox(dossier: Dossier): { deck: string; blocks: ArticleBlock[]; order: string[] } | null {
  if (dossier.stars.length === 0) return null;
  const ranked = [...dossier.stars].sort((a, b) => (b.about?.stars ?? -1) - (a.about?.stars ?? -1));
  const cards: RepoCard[] = ranked.slice(0, MAX_STAR_CARDS).map((star) => ({
    name: star.repo,
    url: `https://github.com/${star.repo}`,
    description: star.about?.description ?? null,
    language: star.about?.language ?? null,
    stars: star.about?.stars ?? null,
    forks: star.about?.forks ?? null,
    topics: star.about?.topics.slice(0, 4) ?? [],
    starredOn: star.starredOn,
  }));
  const more = dossier.stars.length - cards.length;
  return {
    deck: `${plural(dossier.stars.length, "repository", "repositories")} starred this period${more > 0 ? ` — the ${cards.length} best known below` : ""}.`,
    blocks: [{ type: "repos", items: cards }],
    order: ranked.map((star) => star.repo),
  };
}
