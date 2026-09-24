/**
 * The source material the writers work from — everything the GitHub fetch
 * recorded for the period, laid out as a readable dossier instead of one
 * line per event. No LLM call and no network call: it only arranges what
 * `fetchGithubActivity` and `fetchRepoDetails` already brought back.
 *
 * The event list used to be the whole brief — 25 lines of
 * `[type] repo: title`, so a busy week's stars fell off the end and nothing
 * said what a repo *was*. The payloads carry far more: commit messages in
 * full, PR and issue state, release notes, and for starred or new repos
 * their description, language, stars and topics.
 *
 * `Research.forRepo` narrows it to one repository (plus the overview and a
 * one-line index of the rest), for a section that's about that repo.
 */

import type { RepoDetails } from "@/lib/sources/github";
import type { ActivityItem } from "@/lib/sources/types";

/** Repos with a full dossier; the rest get one line in "Also touched". */
const MAX_REPO_DOSSIERS = 12;
/** Per repo, per kind of event — enough to show what the work was, not a changelog. */
const MAX_ITEMS_PER_KIND = 10;
const MAX_STARS_LISTED = 30;
const MAX_GISTS_LISTED = 10;
const EXCERPT_CHARS = 220;
const RELEASE_NOTES_CHARS = 400;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Plural labels for the overview line, in the order a reader cares about. */
const KIND_LABELS: [eventType: string, one: string, many: string][] = [
  ["commit", "commit", "commits"],
  ["pr", "pull request opened", "pull requests opened"],
  ["review", "pull request reviewed", "pull requests reviewed"],
  ["issue", "issue opened", "issues opened"],
  ["release", "release", "releases"],
  ["repo_created", "repository created", "repositories created"],
  ["star", "repository starred", "repositories starred"],
  ["gist", "gist", "gists"],
];

type Raw = Record<string, unknown>;

function raw(item: ActivityItem): Raw {
  return item.raw && typeof item.raw === "object" ? (item.raw as Raw) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** First `max` chars of `text` as one line — markdown noise and line breaks flattened. */
function excerpt(text: string | null, max = EXCERPT_CHARS): string | null {
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

function shortDate(date: Date | null): string {
  return date ? `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}` : "";
}

/** `12400` → `"12.4k"`. */
function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
}

/** `"TypeScript, ★ 1.2k, 40 forks, topics: cli, markdown"` — whatever of that is known. */
export function describeRepo(details: RepoDetails | undefined): string {
  if (!details) return "";
  const parts: string[] = [];
  if (details.language) parts.push(details.language);
  if (details.stars !== null) parts.push(`★ ${compact(details.stars)}`);
  if (details.forks) parts.push(`${compact(details.forks)} forks`);
  if (details.isFork) parts.push("a fork");
  if (details.archived) parts.push("archived");
  if (details.topics.length > 0) parts.push(`topics: ${details.topics.slice(0, 6).join(", ")}`);
  return parts.join(", ");
}

/** `"12 commits, 3 pull requests opened, 1 release"`, busiest first within the reader's order. */
function tally(activity: ActivityItem[]): string {
  const counts = new Map<string, number>();
  for (const item of activity) counts.set(item.eventType, (counts.get(item.eventType) ?? 0) + 1);
  return KIND_LABELS.filter(([type]) => counts.has(type))
    .map(([type, one, many]) => {
      const n = counts.get(type)!;
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

function prLine(item: ActivityItem): string {
  const r = raw(item);
  const pull = (r.pull_request ?? {}) as Raw;
  const state = str(pull.merged_at) ? "merged" : str(r.state) === "open" ? "open" : "closed unmerged";
  const comments = typeof r.comments === "number" && r.comments > 0 ? `, ${r.comments} comments` : "";
  const body = excerpt(str(r.body));
  return `"${item.title}" [${state}${comments}, ${shortDate(item.timestamp)}]${body ? ` — ${body}` : ""}`;
}

function issueLine(item: ActivityItem): string {
  const r = raw(item);
  const state = str(r.state) ?? "open";
  const comments = typeof r.comments === "number" && r.comments > 0 ? `, ${r.comments} comments` : "";
  const labels = Array.isArray(r.labels)
    ? r.labels.map((l) => (l && typeof l === "object" ? str((l as Raw).name) : null)).filter(Boolean)
    : [];
  const labelText = labels.length > 0 ? `, labels: ${labels.join(", ")}` : "";
  const body = excerpt(str(r.body));
  return `"${item.title}" [${state}${comments}${labelText}, ${shortDate(item.timestamp)}]${body ? ` — ${body}` : ""}`;
}

function commitLine(item: ActivityItem): string {
  const commit = (raw(item).commit ?? {}) as Raw;
  const message = str(commit.message) ?? item.title;
  const [subject, ...rest] = message.split("\n");
  const detail = excerpt(rest.join(" "), 160);
  return `${shortDate(item.timestamp)}: "${subject.trim()}"${detail ? ` — ${detail}` : ""}`;
}

function releaseLine(item: ActivityItem): string {
  const r = raw(item);
  const tag = str(r.tag_name);
  const name = item.title && item.title !== tag ? `${item.title} (${tag})` : (tag ?? item.title);
  const pre = r.prerelease === true ? " [pre-release]" : "";
  const notes = excerpt(str(r.body), RELEASE_NOTES_CHARS);
  return `${name}${pre}, ${shortDate(item.timestamp)}${notes ? ` — notes: ${notes}` : ""}`;
}

/** One repo's full dossier: what it is, then what the period did in it. */
function dossier(repo: string, items: ActivityItem[], details: RepoDetails | undefined): string {
  const lines: string[] = [];
  const about = [details?.description, describeRepo(details)].filter(Boolean).join(" — ");
  lines.push(`### ${repo}${about ? ` — ${about}` : ""}`);
  lines.push(`This period: ${tally(items)}.`);

  const byKind = (type: string) => items.filter((item) => item.eventType === type);
  const section = (label: string, list: ActivityItem[], line: (item: ActivityItem) => string) => {
    if (list.length === 0) return;
    lines.push(`${label}:`);
    for (const item of list.slice(0, MAX_ITEMS_PER_KIND)) lines.push(`- ${line(item)}`);
    if (list.length > MAX_ITEMS_PER_KIND) lines.push(`- …and ${list.length - MAX_ITEMS_PER_KIND} more`);
  };

  if (byKind("repo_created").length > 0) lines.push("Created during this period.");
  section("Releases", byKind("release"), releaseLine);
  section("Pull requests opened", byKind("pr"), prLine);
  section("Pull requests reviewed", byKind("review"), (item) => `"${item.title}" (${shortDate(item.timestamp)})`);
  section("Issues opened", byKind("issue"), issueLine);
  section("Commits", byKind("commit"), commitLine);
  return lines.join("\n");
}

export interface Research {
  /** The whole dossier, as one labeled `## Activity` block. */
  text: string;
  /** The same, narrowed to one repo — overview, that repo's dossier, and a one-line index of everything else. */
  forRepo(repo: string): string;
}

/** Builds the period's dossier. Throws when there is nothing at all to write about. */
export function researchPeriod(activity: ActivityItem[], details: Map<string, RepoDetails> = new Map()): Research {
  if (activity.length === 0) {
    throw new Error("No GitHub activity recorded for this period — there is nothing to write about.");
  }
  const detailsOf = (repo: string) => details.get(repo.toLowerCase());

  const work = activity.filter((item) => item.repo && item.repo.includes("/") && item.eventType !== "star");
  const byRepo = new Map<string, ActivityItem[]>();
  for (const item of work) {
    const list = byRepo.get(item.repo!) ?? [];
    list.push(item);
    byRepo.set(item.repo!, list);
  }
  const repos = [...byRepo.entries()].sort((a, b) => b[1].length - a[1].length);
  const detailed = repos.slice(0, MAX_REPO_DOSSIERS);
  const brief = repos.slice(MAX_REPO_DOSSIERS);

  const stars = activity.filter((item) => item.eventType === "star");
  const gists = activity.filter((item) => item.eventType === "gist");

  const days = new Map<string, number>();
  for (const item of activity) {
    if (item.timestamp) {
      const key = item.timestamp.toISOString().slice(0, 10);
      days.set(key, (days.get(key) ?? 0) + 1);
    }
  }
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const languages = new Map<string, number>();
  for (const [repo, items] of repos) {
    const language = detailsOf(repo)?.language;
    if (language) languages.set(language, (languages.get(language) ?? 0) + items.length);
  }

  const overview = [
    "## Overview",
    `${activity.length} recorded events: ${tally(activity)}.`,
    `Work in ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}${stars.length ? `, ${stars.length} starred` : ""}.`,
    days.size > 0 ? `Active on ${days.size} ${days.size === 1 ? "day" : "days"}; busiest ${busiest[0]} with ${busiest[1]} events.` : "",
    languages.size > 0
      ? `Languages of the repositories worked in (by events): ${[...languages.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const starLine = (item: ActivityItem) => {
    const d = detailsOf(item.repo ?? "");
    const about = [d?.description, describeRepo(d)].filter(Boolean).join(" — ");
    return `- ${item.repo}${about ? ` — ${about}` : ""} (starred ${shortDate(item.timestamp)})`;
  };
  const starsBlock =
    stars.length > 0
      ? [
          "## Starred this period",
          "Repositories by other people that caught the user's eye — what they are, not work the user did in them.",
          ...stars.slice(0, MAX_STARS_LISTED).map(starLine),
          stars.length > MAX_STARS_LISTED ? `- …and ${stars.length - MAX_STARS_LISTED} more` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const gistsBlock =
    gists.length > 0
      ? [
          "## Gists",
          ...gists.slice(0, MAX_GISTS_LISTED).map((item) => {
            const files = Object.keys((raw(item).files ?? {}) as Raw);
            return `- "${item.title}" (${shortDate(item.timestamp)})${files.length ? ` — files: ${files.slice(0, 5).join(", ")}` : ""}`;
          }),
        ].join("\n")
      : "";

  const alsoBlock =
    brief.length > 0
      ? `## Also touched\n${brief.map(([repo, items]) => `- ${repo}: ${tally(items)}`).join("\n")}`
      : "";

  const dossiers = detailed.map(([repo, items]) => dossier(repo, items, detailsOf(repo)));
  const worked = dossiers.length > 0 ? `## Repositories worked in\n\n${dossiers.join("\n\n")}` : "";

  const text = ["# Activity", overview, worked, alsoBlock, starsBlock, gistsBlock].filter(Boolean).join("\n\n");

  /** One line per repo/star/gist not in focus — so a section can mention the rest in passing. */
  const index = (except: string) => {
    const lines = [
      ...repos.filter(([repo]) => repo.toLowerCase() !== except).map(([repo, items]) => `- ${repo}: ${tally(items)}`),
      ...stars.filter((item) => item.repo?.toLowerCase() !== except).slice(0, MAX_STARS_LISTED).map((item) => `- starred ${item.repo}`),
    ];
    return lines.length > 0 ? `## Elsewhere this period\n${lines.join("\n")}` : "";
  };

  return {
    text,
    forRepo(repo: string) {
      const key = repo.toLowerCase();
      const own = repos.find(([name]) => name.toLowerCase() === key);
      const star = stars.find((item) => item.repo?.toLowerCase() === key);
      const focus = [
        own ? `## Repositories worked in\n\n${dossier(own[0], own[1], detailsOf(own[0]))}` : "",
        star ? `## Starred this period\n${starLine(star)}` : "",
      ].filter(Boolean);
      if (focus.length === 0) return text;
      return ["# Activity", overview, ...focus, index(key)].filter(Boolean).join("\n\n");
    },
  };
}
