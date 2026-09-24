/**
 * Runnable self-check for the period dossier.
 * `npx tsx scripts/check-dossier.ts`.
 */
import assert from "node:assert/strict";
import { buildDossier, dossierRepos, sliceDossier, type Dossier, type DossierSlice } from "../src/lib/generation/dossier";
import type { RepoDetails } from "../src/lib/sources/github";
import type { ActivityItem } from "../src/lib/sources/types";

/** A commit authored at `local` (with its UTC offset), as the search API reports it. */
function commit(repo: string, local: string, message: string): ActivityItem {
  return { source: "github", eventType: "commit", repo, title: message.split("\n")[0], url: null, timestamp: new Date(local), raw: { commit: { message, author: { date: local } } } };
}
function event(eventType: string, repo: string | null, utc: string, title: string, raw: unknown = null): ActivityItem {
  return { source: "github", eventType, repo, title, url: null, timestamp: new Date(utc), raw };
}
const input = { username: "Me", periodLabel: "September 2026", cadence: "monthly", periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-10-01T00:00:00Z") };

// 55 commits on one repo, deliberately fetched out of order — the old digest kept the first ten it saw.
const many: ActivityItem[] = [];
for (let i = 0; i < 55; i += 1) {
  const day = String(1 + (i % 28)).padStart(2, "0");
  many.push(commit("me/app", `2026-09-${day}T10:${String(i).padStart(2, "0")}:00.000+02:00`, `feat(ui): step ${i}`));
}
many.reverse();

const activity: ActivityItem[] = [
  ...many,
  commit("me/app", "2026-09-10T23:30:00.000+02:00", "fix!: late-night breaking fix\n\nBREAKING CHANGE: drops the old API entirely, which several callers still used."),
  commit("friend/lib", "2026-09-12T08:00:00.000-05:00", "docs: typo"),
  commit("friend/lib", "2026-09-13T08:00:00.000-05:00", "Merge pull request #3 from me/typo"),
  event("pr", "me/app", "2026-09-20T12:00:00Z", "Big feature", { state: "closed", pull_request: { merged_at: "2026-09-21T00:00:00Z" }, comments: 2, body: "Adds **everything**." }),
  event("repo_created", "me/new", "2026-09-05T12:00:00Z", "me/new: fresh"),
  event("star", "acme/tool", "2026-09-07T12:00:00Z", "acme/tool"),
];
const details = new Map<string, RepoDetails>([
  ["me/app", { fullName: "me/app", description: "An app", language: "TypeScript", stars: 3, forks: 0, topics: ["x"], isFork: false, archived: false, url: null }],
  ["acme/tool", { fullName: "acme/tool", description: "A tool", language: "Go", stars: 900, forks: 10, topics: [], isFork: false, archived: false, url: null }],
]);

const dossier: Dossier = buildDossier(activity, details, input);
const app = dossier.repos.find((repo) => repo.name === "me/app")!;

// Every commit kept, oldest first, whatever order the fetch returned them in.
assert.equal(app.counts.commits, 56);
assert.equal(app.commits.length, 56);
assert.equal(app.commitsOmitted, 0);
const dates = app.commits.map((c) => c.date);
assert.deepEqual(dates, [...dates].sort());

// Conventional commits parsed; the hour is the author's own, not UTC.
const late = app.commits.find((c) => c.subject === "late-night breaking fix")!;
assert.equal(late.type, "fix");
assert.equal(late.breaking, true);
assert.equal(late.hour, 23);
assert.equal(late.date, "2026-09-10");
assert.match(late.body!, /drops the old API/);
assert.equal(app.commits[0].type, "feat");
assert.equal(app.commits[0].scope, "ui");
assert.deepEqual(app.commitTypes, { feat: 55, fix: 1 });

// An `area: message` prefix that isn't a conventional type is the scope, not the type.
{
  const areas = buildDossier([commit("me/dots", "2026-09-02T09:00:00.000+00:00", "zsh: faster prompt")], new Map(), input).repos[0];
  assert.deepEqual([areas.commits[0].type, areas.commits[0].scope, areas.commits[0].subject], [null, "zsh", "faster prompt"]);
  assert.deepEqual(areas.commitTypes, { other: 1 });
}

// Own work vs someone else's; merges recognised; a new repo without commits still listed.
const lib = dossier.repos.find((repo) => repo.name === "friend/lib")!;
assert.equal(lib.relation, "contribution");
assert.equal(app.relation, "own");
assert.equal(lib.commits[1].type, "merge");
assert.equal(dossier.repos.find((repo) => repo.name === "me/new")!.createdThisPeriod, true);
assert.deepEqual(dossier.overview.repos.contributions, ["friend/lib"]);
assert.deepEqual(dossier.overview.repos.created, ["me/new"]);

// PR state and counts.
assert.equal(app.pullRequests[0].state, "merged");
assert.equal(app.pullRequests[0].body, "Adds everything.");
assert.equal(dossier.overview.totals.pullRequestsMerged, 1);

// Rhythm: 28 consecutive commit days (1st-28th) is the longest streak; time of day from local hours.
assert.deepEqual(dossier.overview.rhythm.longestStreak, { days: 28, from: "2026-09-01", to: "2026-09-28" });
assert.equal(dossier.overview.rhythm.commitsByTimeOfDay.morning, 57);
assert.equal(dossier.overview.rhythm.commitsByTimeOfDay.evening, 1);
assert.equal(dossier.overview.rhythm.busiestHour!.hour, 10);
assert.ok(dossier.overview.timeline.every((b) => /^2026-W\d{2}$/.test(b.bucket)));
assert.equal(dossier.overview.timeline.reduce((sum, b) => sum + b.events, 0), activity.length);

// Stars: what the repo is, and named in dossierRepos.
assert.equal(dossier.stars[0].about!.description, "A tool");
assert.ok(dossierRepos(dossier).includes("acme/tool"));

// A slice: the focus in full, one line on the rest.
const slice = sliceDossier(dossier, ["ME/APP"]) as DossierSlice;
assert.deepEqual(slice.repos.map((r) => r.name), ["me/app"]);
assert.equal(slice.stars.length, 0);
assert.deepEqual(slice.elsewhere.find((e) => e.name === "friend/lib"), { name: "friend/lib", kind: "contribution", summary: "2 commits" });
assert.deepEqual(slice.elsewhere.find((e) => e.name === "acme/tool"), { name: "acme/tool", kind: "starred", summary: "starred 2026-09-07" });
assert.equal(sliceDossier(dossier, []), dossier);

// A very busy repo: capped, least informative dropped first, still in order.
const busy: ActivityItem[] = [];
for (let i = 0; i < 150; i += 1) busy.push(commit("me/busy", `2026-09-02T09:00:${String(i % 60).padStart(2, "0")}.000+00:00`, i % 3 === 0 ? `feat: thing ${i}` : `chore: bump ${i}`));
const capped = buildDossier(busy, new Map(), input).repos[0];
assert.equal(capped.counts.commits, 150);
assert.equal(capped.commits.length + capped.commitsOmitted, 150);
assert.equal(capped.commits.filter((c) => c.type === "feat").length, 50);

// Nothing at all -> refuses.
assert.throws(() => buildDossier([], new Map(), input));

console.log("dossier self-check: OK");
