/**
 * Runnable self-check for the outline review (`reviewOutline`) and the
 * repo-name resolution it relies on. `npx tsx scripts/check-outline.ts`.
 */
import assert from "node:assert/strict";
import { buildDossier } from "../src/lib/generation/dossier";
import { outlineSchema, resolveRepo, reviewOutline, type Outline } from "../src/lib/generation/outline";
import type { ActivityItem } from "../src/lib/sources/types";

function commit(repo: string, day: string, message: string): ActivityItem {
  const local = `2026-09-${day}T14:00:00.000+02:00`;
  return { source: "github", eventType: "commit", repo, title: message, url: null, timestamp: new Date(local), raw: { commit: { message, author: { date: local } } } };
}
function star(repo: string, day: string): ActivityItem {
  return { source: "github", eventType: "star", repo, title: repo, url: null, timestamp: new Date(`2026-09-${day}T12:00:00Z`), raw: null };
}

const activity: ActivityItem[] = [
  ...Array.from({ length: 20 }, (_, i) => commit("Me/big", String(1 + i).padStart(2, "0"), `feat: step ${i}`)),
  commit("me/small", "05", "fix: one"),
  commit("me/tiny", "06", "chore: two"),
  commit("friend/lib", "07", "docs: three"),
  star("JuliusBrussee/caveman", "10"),
  star("acme/tool", "11"),
];
const dossier = buildDossier(activity, new Map(), {
  username: "me",
  periodLabel: "September 2026",
  cadence: "monthly",
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-10-01T00:00:00Z"),
});
const input = { cadence: "monthly" as const, periodLabel: "September 2026" };
type Section = Outline["sections"][number];
const section = (s: Partial<Section> & Pick<Section, "heading" | "kind">): Section => ({ brief: "b", length: "medium", repos: [], ...s });

// Repo names: exact (any case), a bare name, a typo; nothing ambiguous or unknown.
{
  const names = new Map(["Me/big", "me/small", "JuliusBrussee/caveman", "a/tool", "b/tool"].map((n) => [n.toLowerCase(), n]));
  assert.equal(resolveRepo("ME/BIG", names), "Me/big");
  assert.equal(resolveRepo("https://github.com/me/small/", names), "me/small");
  assert.equal(resolveRepo("caveman", names), "JuliusBrussee/caveman");
  assert.equal(resolveRepo("JuliusBrusese/caveman", names), "JuliusBrussee/caveman");
  assert.equal(resolveRepo("tool", names), null);
  assert.equal(resolveRepo("nobody/else", names), null);
}

// The trace-2 shape: an overview first, a short round-up with no repos named, a long reading list, a second one.
{
  const outline: Outline = {
    headline: "  The Month  ",
    premise: "p",
    sections: [
      section({ heading: "The Month's Rhythm", kind: "overview", repos: ["Me/big"] }),
      section({ heading: "Early Days", kind: "feature", repos: ["me/big"], window: { from: "2026-08-20", to: "2026-09-10" } }),
      section({ heading: "Late Days", kind: "feature", repos: ["me/big"], window: { from: "2026-09-11", to: "2026-09-30" } }),
      section({ heading: "Housekeeping", kind: "roundup", repos: ["me/small", "ghost/repo"] }),
      section({ heading: "The Star List", kind: "reading-list", length: "long", repos: ["JuliusBrusese/caveman", "me/small"] }),
      section({ heading: "More Stars", kind: "reading-list", repos: ["acme/tool"] }),
    ],
  };
  assert.ok(outlineSchema.safeParse(outline).success);
  const reviewed = reviewOutline(outline, dossier, input);
  assert.equal(reviewed.title, "The Month");
  assert.deepEqual(
    reviewed.sections.map((s) => s.heading),
    ["Early Days", "The Month's Rhythm", "Late Days", "Housekeeping", "The Star List"],
  );
  const [early, overview, , housekeeping, stars] = reviewed.sections;
  assert.deepEqual(overview.repos, []);
  assert.deepEqual(early.window, { from: "2026-09-01", to: "2026-09-10" });
  assert.deepEqual(housekeeping.repos, ["me/small", "me/tiny", "friend/lib"]);
  assert.deepEqual(stars.repos, ["JuliusBrussee/caveman", "acme/tool"]);
  assert.equal(stars.lengthTier, "medium");
  assert.equal(reviewed.dropStarsBox, true);
  assert.ok(reviewed.notes.some((n) => n.includes("ghost/repo")));
  assert.ok(reviewed.notes.some((n) => n.includes("folded into")));
}

// Kinds that don't fit their repos are corrected; too many sections are cut; forgotten work joins the round-up.
{
  const outline: Outline = {
    headline: "h",
    premise: "p",
    sections: [
      section({ heading: "About a Star", kind: "feature", repos: ["acme/tool"] }),
      section({ heading: "Two Repos", kind: "feature", repos: ["me/big", "me/small"] }),
      ...Array.from({ length: 10 }, (_, i) => section({ heading: `Filler ${i}`, kind: "overview" })),
    ],
  };
  const reviewed = reviewOutline(outline, dossier, input);
  assert.equal(reviewed.sections.length, 9);
  assert.equal(reviewed.sections[0].heading, "Two Repos");
  assert.equal(reviewed.sections[0].kind, "roundup");
  assert.equal(reviewed.sections[1].kind, "reading-list");
  assert.deepEqual(reviewed.sections[0].repos, ["Me/big", "me/small", "me/tiny", "friend/lib"]);
}

// Forgotten work with no round-up to join is noted.
{
  const reviewed = reviewOutline({ headline: "h", premise: "p", sections: [section({ heading: "Big", kind: "feature", repos: ["me/big"] })] }, dossier, input);
  assert.ok(reviewed.notes.includes("not covered by any section: me/small, me/tiny, friend/lib"));
}

// No outline at all: one section on all the work, and the stars box stays.
{
  const reviewed = reviewOutline(null, dossier, input);
  assert.equal(reviewed.sections.length, 1);
  assert.equal(reviewed.sections[0].kind, "roundup");
  assert.deepEqual(reviewed.sections[0].repos, ["Me/big", "me/small", "me/tiny", "friend/lib"]);
  assert.deepEqual(reviewed.notes, ["no outline — one section on the period as a whole"]);
  assert.equal(reviewed.title, "September 2026");
  assert.equal(reviewed.dropStarsBox, false);
}

console.log("outline self-check: OK");
