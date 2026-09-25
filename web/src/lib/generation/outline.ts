/**
 * The outline — what the outline editor plans, as a typed object instead of
 * a text protocol to parse back — and the `review` that checks it against
 * the dossier before anyone writes a word. Pure: no model calls. The
 * `front-page` workflow asks the outline editor for `outlineSchema` (Mastra
 * structured output) and runs `reviewOutline` as its own step.
 *
 * The editor may name several repositories per section and a window of
 * days, so a section covering three small repos reads those three, and
 * three sections on one busy repo each read their own stretch of it. The
 * review then fixes, in code, what a model reliably gets wrong:
 *   - repo names that aren't real (resolved, typos included, or dropped);
 *   - a section kind that doesn't fit its repos;
 *   - more than one section on the stars, or stars outweighing the work;
 *   - an overview or the stars in the lead slot while there is real work;
 *   - more sections than the period's range;
 *   - work the outline forgot, added to a round-up when there is one.
 * Every change is recorded in `notes`, so Studio shows why the page
 * differs from what the editor asked for.
 */

import { z } from "zod";

import type { Cadence } from "@/lib/edition-helpers";
import type { Dossier } from "@/lib/generation/dossier";
import { resolveRepo } from "@/lib/repo-image";

export const SECTION_KINDS = ["feature", "roundup", "overview", "reading-list"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export type LengthTier = "short" | "medium" | "long";

/**
 * How many sections a period's material may support — a quiet period should
 * still propose fewer. Daily floors at 2, not 1: a lead plus the computed
 * boxes alone reads as a thin page, and even one day's activity can almost
 * always be sliced into two honest angles.
 */
export const SECTION_RANGE: Record<Cadence, readonly [number, number]> = {
  daily: [2, 4],
  weekly: [3, 6],
  monthly: [5, 9],
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the outline editor returns. The descriptions are the field guide Mastra puts in its prompt. */
export const outlineSchema = z.object({
  headline: z.string().describe("A compelling front-page headline for the period"),
  premise: z.string().describe("One short paragraph: what kind of period this was, the thread that ties the sections together"),
  sections: z
    .array(
      z.object({
        heading: z.string().describe("The section's headline"),
        kind: z
          .enum(SECTION_KINDS)
          .describe(
            "feature: one repository's work in depth. roundup: several smaller repositories together. " +
              "overview: the period's shape as a whole (rhythm, totals, mix), no repository in depth. " +
              "reading-list: the starred repositories — other people's work.",
          ),
        brief: z.string().describe("One or two sentences on what this section covers — the writer sees only this and its own material"),
        length: z.enum(["short", "medium", "long"]),
        repos: z
          .array(z.string())
          .describe(
            "owner/name of every repository this section covers, exactly as `name` (or a star's `repo`) appears in the material, " +
              "the main one first. Empty for an overview; the stars it features for a reading list.",
          ),
        window: z
          .object({ from: z.string().describe("YYYY-MM-DD"), to: z.string().describe("YYYY-MM-DD") })
          .nullish()
          .describe("Only when several sections split one repository's period by date: the days this one covers. Otherwise null."),
      }),
    )
    .describe("In page order; the first is the lead story"),
});

export type Outline = z.infer<typeof outlineSchema>;

export interface ReviewedSection {
  heading: string;
  brief: string;
  kind: SectionKind;
  lengthTier: LengthTier;
  /** Resolved canonical names; the first is the section's picture. */
  repos: string[];
  window: { from: string; to: string } | null;
}

export interface ReviewedOutline {
  title: string;
  premise: string;
  sections: ReviewedSection[];
  /** A reading-list section covers the stars — the computed stars box would repeat it. */
  dropStarsBox: boolean;
  /** Every change the review made, for Studio. */
  notes: string[];
}

/**
 * Checks the outline against the dossier and fixes what it can (see the
 * header). Never throws: an outline with nothing usable left becomes one
 * section on all the period's work, or on the period as a whole.
 */
export function reviewOutline(outline: Outline | null, dossier: Dossier, input: { cadence: Cadence; periodLabel: string }): ReviewedOutline {
  const notes: string[] = [];
  const worked = new Map(dossier.repos.map((repo) => [repo.name.toLowerCase(), repo.name]));
  const starred = new Map(dossier.stars.map((star) => [star.repo.toLowerCase(), star.repo]));
  const all = new Map([...starred, ...worked]);
  const commitsOf = (name: string) => dossier.repos.find((repo) => repo.name === name)?.counts.commits ?? 0;
  const { from: periodFrom, to: periodTo } = dossier.overview.period;
  const isWorked = (name: string) => worked.has(name.toLowerCase());

  let sections: ReviewedSection[] = (outline?.sections ?? []).flatMap((raw, index) => {
    const heading = raw.heading?.trim();
    if (!heading) {
      notes.push(`section ${index + 1}: no heading — dropped`);
      return [];
    }
    const repos: string[] = [];
    for (const name of raw.repos ?? []) {
      const resolved = resolveRepo(name, all);
      if (!resolved) notes.push(`"${heading}": "${name}" isn't a repository in the material — dropped`);
      else if (!repos.includes(resolved)) {
        if (resolved.toLowerCase() !== name.trim().toLowerCase()) notes.push(`"${heading}": "${name}" read as ${resolved}`);
        repos.push(resolved);
      }
    }

    let kind: SectionKind = SECTION_KINDS.includes(raw.kind) ? raw.kind : "feature";
    const work = repos.filter(isWorked);
    const stars = repos.filter((name) => !isWorked(name));
    if (kind === "reading-list") {
      if (work.length > 0) notes.push(`"${heading}": a reading list covers stars only — dropped ${work.join(", ")}`);
    } else if (kind !== "overview" && work.length === 0) {
      const becomes = stars.length > 0 ? "reading-list" : "overview";
      notes.push(`"${heading}": a ${kind} with no repository worked in — now a ${becomes}`);
      kind = becomes;
    } else if (kind === "feature" && work.length > 1) {
      kind = "roundup";
    }

    let window = null as ReviewedSection["window"];
    if (raw.window && kind !== "overview" && kind !== "reading-list") {
      const from = raw.window.from < periodFrom ? periodFrom : raw.window.from;
      const to = raw.window.to > periodTo ? periodTo : raw.window.to;
      if (DAY.test(from) && DAY.test(to) && from <= to) window = { from, to };
      else notes.push(`"${heading}": window ${raw.window.from}–${raw.window.to} isn't a range of days in the period — ignored`);
    }

    return [
      {
        heading,
        brief: raw.brief?.trim() || "",
        kind,
        lengthTier: raw.length ?? "medium",
        repos: kind === "overview" ? [] : kind === "reading-list" ? stars : [...work, ...stars],
        window,
      },
    ];
  });

  // One reading list at most; the rest of its kind fold into the first.
  const lists = sections.filter((section) => section.kind === "reading-list");
  if (lists.length > 1) {
    for (const extra of lists.slice(1)) {
      for (const name of extra.repos) if (!lists[0].repos.includes(name)) lists[0].repos.push(name);
      notes.push(`"${extra.heading}": a second section on the stars — folded into "${lists[0].heading}"`);
    }
    sections = sections.filter((section) => !lists.slice(1).includes(section));
  }
  // The stars are what the user read, not what they did: never the longest story while there's work.
  const hasWork = dossier.repos.some((repo) => repo.counts.commits + repo.counts.pullRequestsOpened + repo.counts.releases > 0);
  if (lists[0] && hasWork && lists[0].lengthTier === "long") {
    lists[0].lengthTier = "medium";
    notes.push(`"${lists[0].heading}": the stars shouldn't outweigh the work — long → medium`);
  }

  // The lead is the biggest piece of work, not the overview or the stars.
  const isStory = (section: ReviewedSection) => section.kind === "feature" || section.kind === "roundup";
  if (sections.length > 1 && !isStory(sections[0])) {
    const lead = sections.filter(isStory).sort((a, b) => commitsOf(b.repos[0]) - commitsOf(a.repos[0]))[0];
    if (lead) {
      sections = [lead, ...sections.filter((section) => section !== lead)];
      notes.push(`"${lead.heading}" moved to the lead, ahead of a${sections[1].kind === "overview" ? "n overview" : " reading list"}`);
    }
  }

  const [, max] = SECTION_RANGE[input.cadence];
  if (sections.length > max) {
    notes.push(`${sections.length} sections for a ${input.cadence} page — kept the first ${max}`);
    sections = sections.slice(0, max);
  }

  if (sections.length === 0) {
    const work = dossier.repos.filter((repo) => repo.counts.commits > 0).map((repo) => repo.name);
    notes.push(outline ? "no usable section — one on the period as a whole" : "no outline — one section on the period as a whole");
    sections = [
      {
        heading: outline?.headline?.trim() || input.periodLabel,
        brief: "Cover the period's work as a whole, the busiest repository first.",
        kind: work.length > 1 ? "roundup" : work.length === 1 ? "feature" : "overview",
        lengthTier: "long",
        repos: work,
        window: null,
      },
    ];
  }

  // Work nobody covers joins a round-up if there is one; otherwise every section's `elsewhere` still names it.
  const covered = new Set(sections.flatMap((section) => section.repos));
  const uncovered = dossier.repos.filter((repo) => !covered.has(repo.name) && repo.counts.commits > 0).map((repo) => repo.name);
  if (uncovered.length > 0) {
    const roundup = sections.find((section) => section.kind === "roundup" && !section.window);
    if (roundup) {
      roundup.repos.push(...uncovered);
      notes.push(`"${roundup.heading}": added ${uncovered.join(", ")}, which no section covered`);
    } else {
      notes.push(`not covered by any section: ${uncovered.join(", ")}`);
    }
  }

  return {
    title: outline?.headline?.trim() || input.periodLabel,
    premise: outline?.premise?.trim() || "",
    sections,
    dropStarsBox: sections.some((section) => section.kind === "reading-list"),
    notes,
  };
}
