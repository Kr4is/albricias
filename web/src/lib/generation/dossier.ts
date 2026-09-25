/**
 * The period's dossier — everything the GitHub fetch recorded, as one typed
 * JSON document the writers read (and Mastra Studio shows, field by field).
 * No LLM call and no network call: it only arranges and counts what
 * `fetchGithubActivity` and `fetchRepoDetails` already brought back.
 *
 * It replaces a markdown digest that kept the first ten commits a repo
 * happened to list (a month with 55 lost its whole second half), flattened
 * every event into prose the model had to parse back, and precomputed a
 * copy of itself per repo. Here:
 *   - every commit is kept, in order, with its conventional-commit type and
 *     scope and the hour it was made in the author's own timezone — capped
 *     only on a very busy repo, least informative first (`commitsOmitted`
 *     says how many);
 *   - the facts worth a headline are computed, not left to the model to
 *     count: streaks, the busiest day and weekday, what time of day the work
 *     happened, the mix of commit types, the week-by-week arc, new
 *     repositories, and work in other people's repositories;
 *   - `sliceDossier` narrows it to what one section is about: the
 *     period's shape, the stars, or some repositories over some days.
 */

import { z } from "zod";

import { isoWeek } from "@/lib/edition-helpers";
import type { RepoDetails } from "@/lib/sources/github";
import type { ActivityItem } from "@/lib/sources/types";

// ---------------------------------------------------------------------------
// Schema — also the documentation of what the writers are given
// ---------------------------------------------------------------------------

const aboutSchema = z
  .object({
    description: z.string().nullable(),
    language: z.string().nullable(),
    stars: z.number().nullable(),
    forks: z.number().nullable(),
    topics: z.array(z.string()),
    isFork: z.boolean(),
    archived: z.boolean(),
  })
  .describe("What the repository is, from GitHub.");

const commitSchema = z.object({
  date: z.string().describe("YYYY-MM-DD, in the author's own timezone"),
  hour: z.number().nullable().describe("0-23, in the author's own timezone"),
  type: z.string().nullable().describe("Conventional-commit type (feat, fix, ci, chore, docs, refactor…), or 'merge'; null when the message doesn't follow the convention"),
  scope: z.string().nullable(),
  breaking: z.boolean(),
  subject: z.string(),
  body: z.string().nullable().describe("Excerpt of the message body — kept for the commits that say most"),
});

const pullRequestSchema = z.object({
  title: z.string(),
  date: z.string(),
  state: z.enum(["merged", "open", "closed"]),
  comments: z.number(),
  body: z.string().nullable(),
});

const issueSchema = z.object({
  title: z.string(),
  date: z.string(),
  state: z.string(),
  comments: z.number(),
  labels: z.array(z.string()),
  body: z.string().nullable(),
});

const releaseSchema = z.object({
  name: z.string(),
  tag: z.string().nullable(),
  date: z.string(),
  prerelease: z.boolean(),
  notes: z.string().nullable(),
});

const countsSchema = z.object({
  commits: z.number(),
  pullRequestsOpened: z.number(),
  pullRequestsMerged: z.number(),
  reviews: z.number(),
  issuesOpened: z.number(),
  releases: z.number(),
});

const repoSchema = z.object({
  name: z.string().describe("owner/name"),
  relation: z.enum(["own", "contribution"]).describe("'contribution' = someone else's repository the user worked in"),
  createdThisPeriod: z.boolean(),
  about: aboutSchema.nullable(),
  counts: countsSchema,
  activeDays: z.number(),
  firstActive: z.string(),
  lastActive: z.string(),
  commitTypes: z.record(z.string(), z.number()).describe("Commits per conventional-commit type ('other' when untyped)"),
  releases: z.array(releaseSchema),
  pullRequests: z.array(pullRequestSchema),
  reviews: z.array(z.object({ title: z.string(), date: z.string() })),
  issues: z.array(issueSchema),
  commits: z.array(commitSchema).describe("In order, oldest first"),
  commitsOmitted: z.number().describe("Commits left out of `commits` on a very busy repo (least informative first); `counts.commits` has them all"),
});

const starSchema = z.object({
  repo: z.string(),
  starredOn: z.string(),
  about: aboutSchema.nullable(),
});

const gistSchema = z.object({
  description: z.string(),
  date: z.string(),
  files: z.array(z.string()),
});

const overviewSchema = z.object({
  period: z.object({ label: z.string(), cadence: z.string(), from: z.string(), to: z.string(), days: z.number() }),
  totals: z.object({
    events: z.number(),
    commits: z.number(),
    pullRequestsOpened: z.number(),
    pullRequestsMerged: z.number(),
    reviews: z.number(),
    issuesOpened: z.number(),
    releases: z.number(),
    reposCreated: z.number(),
    starred: z.number(),
    gists: z.number(),
  }),
  repos: z.object({ own: z.array(z.string()), contributions: z.array(z.string()), created: z.array(z.string()) }),
  rhythm: z.object({
    activeDays: z.number(),
    longestStreak: z.object({ days: z.number(), from: z.string(), to: z.string() }).nullable(),
    busiestDay: z.object({ date: z.string(), events: z.number() }).nullable(),
    busiestWeekday: z.object({ weekday: z.string(), events: z.number() }).nullable(),
    weekendShare: z.number().describe("Fraction of events on Saturday or Sunday, 0-1"),
    commitsByTimeOfDay: z.object({ night: z.number(), morning: z.number(), afternoon: z.number(), evening: z.number() }).describe("night 0-5h, morning 6-11h, afternoon 12-17h, evening 18-23h, author's own timezone"),
    busiestHour: z.object({ hour: z.number(), commits: z.number() }).nullable(),
  }),
  commitTypes: z.record(z.string(), z.number()),
  languages: z.array(z.object({ language: z.string(), events: z.number() })).describe("Languages of the repositories worked in, weighted by events"),
  timeline: z
    .array(z.object({ bucket: z.string(), events: z.number(), topRepo: z.string().nullable() }))
    .describe("Events per day (weekly/daily periods) or per ISO week (monthly), with the busiest repository in each"),
});

export const dossierSchema = z.object({
  overview: overviewSchema,
  repos: z.array(repoSchema).describe("Repositories worked in, busiest first"),
  stars: z.array(starSchema).describe("Other people's repositories the user starred — what caught their eye, not their work"),
  gists: z.array(gistSchema),
});

export type Dossier = z.infer<typeof dossierSchema>;
type Repo = z.infer<typeof repoSchema>;
type Commit = z.infer<typeof commitSchema>;

/** A section's material: the overview, the repositories it's about in full, and one line on everything else. */
export const dossierSliceSchema = z.object({
  overview: overviewSchema,
  window: z
    .object({ from: z.string(), to: z.string() })
    .nullable()
    .describe("When set, the repositories' commits, pull requests, issues, reviews and releases are only those between these dates (their `counts` still cover the whole period)"),
  repos: z.array(repoSchema),
  stars: z.array(starSchema),
  elsewhere: z.array(z.object({ name: z.string(), kind: z.enum(["own", "contribution", "starred"]), summary: z.string() })),
});
export type DossierSlice = z.infer<typeof dossierSliceSchema>;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Commits kept per repository — past this, the least informative are dropped first. */
const MAX_COMMITS_PER_REPO = 120;
/** Commits per repository that keep an excerpt of their body. */
const MAX_BODIES_PER_REPO = 20;
const BODY_CHARS = 240;
const PR_BODY_CHARS = 300;
const RELEASE_NOTES_CHARS = 500;
const MAX_ITEMS_PER_KIND = 25;
const MAX_STARS = 40;
const MAX_GISTS = 15;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function raw(item: ActivityItem): Raw {
  return item.raw && typeof item.raw === "object" ? (item.raw as Raw) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** First `max` chars of `text` as one line — markdown noise and line breaks flattened. */
function excerpt(text: string | null, max: number): string | null {
  if (!text) return null;
  const flat = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/[#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

function utcDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * A commit's date and hour where its author was: GitHub reports a commit's
 * author date with the author's UTC offset (`…T23:40:00.000+02:00`), which
 * the parsed `timestamp` loses. Falls back to UTC.
 */
function localTime(item: ActivityItem): { date: string; hour: number | null } {
  const commit = (raw(item).commit ?? {}) as Raw;
  const stamp = str(((commit.author ?? {}) as Raw).date);
  const match = stamp?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!stamp || !match) return { date: utcDate(item.timestamp), hour: item.timestamp ? item.timestamp.getUTCHours() : null };
  return { date: `${match[1]}-${match[2]}-${match[3]}`, hour: Number(match[4]) };
}

const CONVENTIONAL = /^([\w.-]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * The conventional-commit types. A prefix that isn't one — the common
 * `zsh: faster prompt` or `api: add endpoint` — names the area, not the
 * kind of change: it becomes the scope, and the type stays unknown.
 */
const COMMIT_TYPES = new Set(["feat", "fix", "docs", "style", "refactor", "perf", "test", "tests", "build", "ci", "chore", "revert", "deps", "release"]);

function parseCommit(item: ActivityItem): Commit {
  const message = str(((raw(item).commit ?? {}) as Raw).message) ?? item.title;
  const [first, ...rest] = message.split("\n");
  const subjectLine = first.trim();
  const { date, hour } = localTime(item);
  const body = rest.join("\n").trim() || null;
  const conventional = subjectLine.match(CONVENTIONAL);
  const typed = conventional && COMMIT_TYPES.has(conventional[1].toLowerCase());
  const merge = /^Merge (pull request|branch|remote-tracking)/i.test(subjectLine);
  return {
    date,
    hour,
    type: merge ? "merge" : typed ? conventional[1].toLowerCase() : null,
    scope: (typed ? conventional[2] : conventional?.[1]) || null,
    breaking: Boolean(conventional?.[3]) || /BREAKING CHANGE/.test(body ?? ""),
    subject: conventional ? conventional[4].trim() : subjectLine,
    body,
  };
}

/** How much a commit says — what decides which keep a body excerpt, and which go first on a very busy repo. */
function weight(commit: Commit): number {
  let score = 0;
  if (commit.breaking) score += 4;
  if (commit.type === "feat") score += 3;
  if (commit.type === "fix" || commit.type === "perf" || commit.type === "refactor") score += 2;
  if (commit.body && commit.body.length > 80) score += 2;
  if (commit.type === "merge") score -= 3;
  if (commit.type === "chore" || commit.type === "style" || commit.type === "ci" || commit.type === "build") score -= 1;
  return score;
}

/** Keeps the `limit` highest-weighted items, in their original order. */
function keepHeaviest<T>(items: T[], limit: number, score: (item: T) => number): T[] {
  if (items.length <= limit) return items;
  const keep = new Set(
    items
      .map((item, index) => ({ index, score: score(item) }))
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, limit)
      .map(({ index }) => index),
  );
  return items.filter((_, index) => keep.has(index));
}

function pullRequest(item: ActivityItem): z.infer<typeof pullRequestSchema> {
  const r = raw(item);
  const merged = Boolean(str(((r.pull_request ?? {}) as Raw).merged_at));
  return {
    title: item.title,
    date: utcDate(item.timestamp),
    state: merged ? "merged" : str(r.state) === "open" ? "open" : "closed",
    comments: typeof r.comments === "number" ? r.comments : 0,
    body: excerpt(str(r.body), PR_BODY_CHARS),
  };
}

function issue(item: ActivityItem): z.infer<typeof issueSchema> {
  const r = raw(item);
  const labels = Array.isArray(r.labels)
    ? r.labels.map((label) => (label && typeof label === "object" ? str((label as Raw).name) : null)).filter((name): name is string => Boolean(name))
    : [];
  return {
    title: item.title,
    date: utcDate(item.timestamp),
    state: str(r.state) ?? "open",
    comments: typeof r.comments === "number" ? r.comments : 0,
    labels,
    body: excerpt(str(r.body), PR_BODY_CHARS),
  };
}

function release(item: ActivityItem): z.infer<typeof releaseSchema> {
  const r = raw(item);
  return {
    name: item.title,
    tag: str(r.tag_name),
    date: utcDate(item.timestamp),
    prerelease: r.prerelease === true,
    notes: excerpt(str(r.body), RELEASE_NOTES_CHARS),
  };
}

function about(details: RepoDetails | undefined): z.infer<typeof aboutSchema> | null {
  if (!details) return null;
  const { description, language, stars, forks, topics, isFork, archived } = details;
  return { description, language, stars, forks, topics: topics.slice(0, 8), isFork, archived };
}

function tally<T>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function top<T>(counts: Map<T, number>): [T, number] | null {
  let best: [T, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best;
}

function sortedRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

/** `12 commits, 1 PR (merged)` — one line on a repository nobody's section is about. */
function summarize(repo: Repo): string {
  const c = repo.counts;
  const parts = [
    c.commits && `${c.commits} ${c.commits === 1 ? "commit" : "commits"}`,
    c.pullRequestsOpened && `${c.pullRequestsOpened} PR${c.pullRequestsOpened === 1 ? "" : "s"} opened (${c.pullRequestsMerged} merged)`,
    c.reviews && `${c.reviews} review${c.reviews === 1 ? "" : "s"}`,
    c.issuesOpened && `${c.issuesOpened} issue${c.issuesOpened === 1 ? "" : "s"}`,
    c.releases && `${c.releases} release${c.releases === 1 ? "" : "s"}`,
    repo.createdThisPeriod && "created this period",
  ].filter(Boolean);
  return parts.join(", ") || "touched";
}

const dayMs = (day: string) => new Date(`${day}T00:00:00Z`).getTime();

/** The longest run of consecutive days in `days` (sorted `YYYY-MM-DD`s), or `null` for none. */
function longestRun(days: string[]): { days: number; from: string; to: string } | null {
  let best: { days: number; from: string; to: string } | null = null;
  let start = 0;
  for (let i = 0; i < days.length; i += 1) {
    if (i > 0 && dayMs(days[i]) - dayMs(days[i - 1]) !== DAY_MS) start = i;
    const length = i - start + 1;
    if (!best || length > best.days) best = { days: length, from: days[start], to: days[i] };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface DossierInput {
  username: string;
  periodLabel: string;
  cadence: string;
  periodStart: Date;
  periodEnd: Date;
}

/** Builds the period's dossier. Throws when there is nothing at all to write about. */
export function buildDossier(activity: ActivityItem[], details: Map<string, RepoDetails>, input: DossierInput): Dossier {
  if (activity.length === 0) {
    throw new Error("No GitHub activity recorded for this period — there is nothing to write about.");
  }
  const detailsOf = (repo: string) => details.get(repo.toLowerCase());
  const user = input.username.toLowerCase();

  // Each event's day (the author's own for commits) — what every rhythm fact counts.
  const dayOf = new Map<ActivityItem, string>();
  const commitOf = new Map<ActivityItem, Commit>();
  for (const item of activity) {
    if (item.eventType === "commit") {
      const commit = parseCommit(item);
      commitOf.set(item, commit);
      dayOf.set(item, commit.date);
    } else {
      dayOf.set(item, utcDate(item.timestamp));
    }
  }

  // ---- repositories worked in -------------------------------------------
  const work = activity.filter((item) => item.repo?.includes("/") && item.eventType !== "star");
  const byRepo = new Map<string, ActivityItem[]>();
  for (const item of work) byRepo.set(item.repo!, [...(byRepo.get(item.repo!) ?? []), item]);

  const repos: Repo[] = [...byRepo.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, items]) => {
      const kind = (type: string) => items.filter((item) => item.eventType === type);
      const byTime = (a: ActivityItem, b: ActivityItem) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0);
      const allCommits = kind("commit").sort(byTime).map((item) => commitOf.get(item)!);
      const kept = keepHeaviest(allCommits, MAX_COMMITS_PER_REPO, weight);
      const withBodies = new Set(keepHeaviest(kept.filter((c) => c.body), MAX_BODIES_PER_REPO, weight));
      const commits = kept.map((c) => ({ ...c, body: withBodies.has(c) ? excerpt(c.body, BODY_CHARS) : null }));
      const prs = kind("pr").sort(byTime).map(pullRequest);
      const days = [...new Set(items.map((item) => dayOf.get(item)!).filter(Boolean))].sort();
      return {
        name,
        relation: name.split("/")[0].toLowerCase() === user ? ("own" as const) : ("contribution" as const),
        createdThisPeriod: kind("repo_created").length > 0,
        about: about(detailsOf(name)),
        counts: {
          commits: allCommits.length,
          pullRequestsOpened: prs.length,
          pullRequestsMerged: prs.filter((pr) => pr.state === "merged").length,
          reviews: kind("review").length,
          issuesOpened: kind("issue").length,
          releases: kind("release").length,
        },
        activeDays: days.length,
        firstActive: days[0] ?? "",
        lastActive: days[days.length - 1] ?? "",
        commitTypes: sortedRecord(tally(allCommits.map((c) => c.type ?? "other"))),
        releases: kind("release").sort(byTime).slice(0, MAX_ITEMS_PER_KIND).map(release),
        pullRequests: prs.slice(0, MAX_ITEMS_PER_KIND),
        reviews: kind("review").sort(byTime).slice(0, MAX_ITEMS_PER_KIND).map((item) => ({ title: item.title, date: utcDate(item.timestamp) })),
        issues: kind("issue").sort(byTime).slice(0, MAX_ITEMS_PER_KIND).map(issue),
        commits,
        commitsOmitted: allCommits.length - commits.length,
      };
    });

  // ---- stars and gists ---------------------------------------------------
  const stars = activity
    .filter((item) => item.eventType === "star" && item.repo)
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0))
    .slice(0, MAX_STARS)
    .map((item) => ({ repo: item.repo!, starredOn: utcDate(item.timestamp), about: about(detailsOf(item.repo!)) }));
  const gists = activity
    .filter((item) => item.eventType === "gist")
    .slice(0, MAX_GISTS)
    .map((item) => ({ description: item.title, date: utcDate(item.timestamp), files: Object.keys((raw(item).files ?? {}) as Raw).slice(0, 8) }));

  // ---- rhythm ------------------------------------------------------------
  const eventDays = activity.map((item) => dayOf.get(item)!).filter(Boolean);
  const perDay = tally(eventDays);
  const activeDays = [...perDay.keys()].sort();

  const longestStreak = longestRun(activeDays);

  const weekdayOf = (day: string) => WEEKDAYS[new Date(dayMs(day)).getUTCDay()];
  const busiestWeekday = top(tally(eventDays.map(weekdayOf)));
  const busiestDay = top(perDay);
  const weekend = eventDays.filter((day) => ["Saturday", "Sunday"].includes(weekdayOf(day))).length;

  const hours = [...commitOf.values()].map((c) => c.hour).filter((hour): hour is number => hour !== null);
  const busiestHour = top(tally(hours));
  const timeOfDay = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const hour of hours) timeOfDay[hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"] += 1;

  const periodDays = Math.round((input.periodEnd.getTime() - input.periodStart.getTime()) / DAY_MS);
  const bucketOf = (day: string) => {
    if (periodDays <= 7) return day;
    const { year, week } = isoWeek(new Date(`${day}T00:00:00Z`));
    return `${year}-W${String(week).padStart(2, "0")}`;
  };
  const buckets = new Map<string, ActivityItem[]>();
  for (const item of activity) {
    const day = dayOf.get(item);
    if (day) buckets.set(bucketOf(day), [...(buckets.get(bucketOf(day)) ?? []), item]);
  }
  const timeline = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, items]) => ({ bucket, events: items.length, topRepo: top(tally(items.filter((i) => i.eventType !== "star" && i.repo).map((i) => i.repo!)))?.[0] ?? null }));

  const languages = new Map<string, number>();
  for (const repo of repos) {
    const language = repo.about?.language;
    const events = byRepo.get(repo.name)?.length ?? 0;
    if (language) languages.set(language, (languages.get(language) ?? 0) + events);
  }

  const count = (type: string) => activity.filter((item) => item.eventType === type).length;
  const allCommits = [...commitOf.values()];

  return {
    overview: {
      period: {
        label: input.periodLabel,
        cadence: input.cadence,
        from: utcDate(input.periodStart),
        to: utcDate(new Date(input.periodEnd.getTime() - DAY_MS)),
        days: periodDays,
      },
      totals: {
        events: activity.length,
        commits: count("commit"),
        pullRequestsOpened: count("pr"),
        pullRequestsMerged: repos.reduce((sum, repo) => sum + repo.counts.pullRequestsMerged, 0),
        reviews: count("review"),
        issuesOpened: count("issue"),
        releases: count("release"),
        reposCreated: count("repo_created"),
        starred: count("star"),
        gists: count("gist"),
      },
      repos: {
        own: repos.filter((repo) => repo.relation === "own").map((repo) => repo.name),
        contributions: repos.filter((repo) => repo.relation === "contribution").map((repo) => repo.name),
        created: repos.filter((repo) => repo.createdThisPeriod).map((repo) => repo.name),
      },
      rhythm: {
        activeDays: activeDays.length,
        longestStreak,
        busiestDay: busiestDay && { date: busiestDay[0], events: busiestDay[1] },
        busiestWeekday: busiestWeekday && { weekday: busiestWeekday[0], events: busiestWeekday[1] },
        weekendShare: eventDays.length ? Math.round((weekend / eventDays.length) * 100) / 100 : 0,
        commitsByTimeOfDay: timeOfDay,
        busiestHour: busiestHour && { hour: busiestHour[0], commits: busiestHour[1] },
      },
      commitTypes: sortedRecord(tally(allCommits.map((c) => c.type ?? "other"))),
      languages: [...languages.entries()].sort((a, b) => b[1] - a[1]).map(([language, events]) => ({ language, events })),
      timeline,
    },
    repos,
    stars,
    gists,
  };
}

/** What a section reads — which part of the dossier, see `sliceDossier`. */
export interface SliceFocus {
  /** `overview`: the whole period's shape, no repository in detail. `reading-list`: the stars. Anything else: `repos`. */
  kind: "overview" | "reading-list" | "repos";
  repos: string[];
  /** Narrow the focus repositories' dated items to these days (inclusive). */
  window?: { from: string; to: string } | null;
}

/**
 * A section's material: the overview, the repositories (worked in or
 * starred) it's about in full, and one line on everything else — so it can
 * mention the rest in passing without being able to write about it.
 *
 * An `overview` section gets no repository in full — its facts are the
 * overview's, and `elsewhere` names every repository with its counts. A
 * `reading-list` gets every star, the ones it names first.
 * With a `window`, a focus repository keeps only what falls inside it —
 * how three sections on one busy repository each read their own stretch of
 * it instead of all of it — unless that would leave it empty.
 */
export function sliceDossier(dossier: Dossier, focus: SliceFocus): DossierSlice {
  const keys = new Set(focus.repos.map((name) => name.toLowerCase()));
  const inFocus = (name: string) => keys.has(name.toLowerCase());
  const repoFocus = focus.kind === "overview" ? () => false : inFocus;
  const starFocus = focus.kind === "overview" ? () => false : focus.kind === "reading-list" ? () => true : inFocus;
  const window = focus.kind === "repos" && focus.window && focus.window.from <= focus.window.to ? focus.window : null;
  const within = <T extends { date: string }>(items: T[]) => (window ? items.filter((item) => item.date >= window.from && item.date <= window.to) : items);
  const narrow = (repo: Repo): Repo => {
    if (!window) return repo;
    const narrowed = {
      ...repo,
      commits: within(repo.commits),
      pullRequests: within(repo.pullRequests),
      reviews: within(repo.reviews),
      issues: within(repo.issues),
      releases: within(repo.releases),
    };
    const empty = narrowed.commits.length + narrowed.pullRequests.length + narrowed.reviews.length + narrowed.issues.length + narrowed.releases.length === 0;
    return empty ? repo : narrowed;
  };
  return {
    overview: dossier.overview,
    window,
    repos: dossier.repos.filter((repo) => repoFocus(repo.name)).map(narrow),
    // A reading list replaces the stars box, so it reads every star — the ones it features first.
    stars: dossier.stars.filter((star) => starFocus(star.repo)).sort((a, b) => Number(inFocus(b.repo)) - Number(inFocus(a.repo))),
    elsewhere: [
      ...dossier.repos.filter((repo) => !repoFocus(repo.name)).map((repo) => ({ name: repo.name, kind: repo.relation, summary: summarize(repo) })),
      ...dossier.stars.filter((star) => !starFocus(star.repo)).map((star) => ({ name: star.repo, kind: "starred" as const, summary: `starred ${star.starredOn}` })),
    ],
  };
}

/** Every repository the dossier names — the only names a section may be assigned. */
export function dossierRepos(dossier: Dossier): string[] {
  return [...dossier.repos.map((repo) => repo.name), ...dossier.stars.map((star) => star.repo)];
}

/** The dossier (or a slice) as the model reads it: compact JSON — no indentation, which only costs tokens. */
export function dossierText(material: Dossier | DossierSlice): string {
  return JSON.stringify(material);
}

/** `"TypeScript, ★ 1.2k, 40 forks"` — whatever of that is known, for the stars box. */
export function describeRepo(details: RepoDetails | undefined): string {
  if (!details) return "";
  const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
  const parts: string[] = [];
  if (details.language) parts.push(details.language);
  if (details.stars !== null) parts.push(`★ ${compact(details.stars)}`);
  if (details.forks) parts.push(`${compact(details.forks)} forks`);
  if (details.isFork) parts.push("a fork");
  if (details.archived) parts.push("archived");
  if (details.topics.length > 0) parts.push(`topics: ${details.topics.slice(0, 6).join(", ")}`);
  return parts.join(", ");
}
