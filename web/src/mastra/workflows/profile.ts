/**
 * Profile workflow — research → outline → per-section drafts → data section → assemble.
 *
 * Replaces a single big "write the whole 900–1500 word profile in one call"
 * request with several small, tightly-scoped ones: `build-outline` proposes
 * a handful of sections, each pointed at just the relevant slice of the
 * source material, then `write-section` writes each one independently.
 * Built to address a real, repeated failure: the self-hosted "thinking"
 * model behind this app's LiteLLM proxy sometimes reasons forever on a
 * long, demanding profile prompt and returns empty text (see
 * `runNewspaperAgent`'s doc comment in `@/mastra/agents/base`) — raising or
 * removing the token budget already didn't fix this, so the lever left is
 * what one call is *asked to do*, not how many tokens it's allowed.
 *
 * Shape:
 *   research-repo  →  build-outline  →  foreach(write-section, { concurrency: PROFILE_SECTION_CONCURRENCY })  →  write-data-section  →  assemble-article
 *
 * The two ends of that chain are deliberately *not* LLM calls.
 * `research-repo` gathers real external material — GitHub facts
 * (`@/lib/sources/github-repo-facts`) and docs/comparison text
 * (`@/lib/sources/external-context`) — in plain imperative code rather than
 * handing an agent a "browse the web" tool loop, which would mean betting the
 * whole feature on the reliability of exactly the backend this file exists to
 * work around. `write-data-section` narrates numbers it is handed verbatim and
 * then appends chart blocks *built in code* from the same facts bundle, so a
 * chart in a profile article cannot contain a figure the model invented — it
 * never had to transcribe one.
 *
 * Like `chronicle.ts`, this workflow is driven with `run.stream()` and its step
 * events are surfaced live in `Edition.generationProgress` — see
 * `@/lib/generation`'s `applyProfileStepProgress` and the `PROFILE_STEP_LABELS`
 * map beside it. That is a reversal: this comment used to argue there was no
 * live view worth feeding, because a profile article is generated one at a time
 * behind the coarse "writing…" single-piece retry UI. The reasoning expired when
 * the workflow grew from a single call into the five steps above — each of them
 * slow enough that one undifferentiated "writing…" reads as a hang. Chronicle
 * reports per *section* of an edition; this reports per *step* of one article,
 * plus the section `foreach`'s own "N of M" inside `write-section`.
 *
 * Every step's own prompt/response/timing is still captured after the fact too:
 * each step
 * folds its own trace fields into what it hands the next one (see
 * `sectionJobSchema`/`sectionOutcomeSchema` below), and `assemble-article`
 * — the last step — is where that's finally shaped into the
 * `GenerationTrace` object (`@/mastra/schemas`) persisted at
 * `Article.sourceData.generationTrace` by `@/lib/generation`'s
 * `generateArticleFromSource` and read back by `regenerateProfileSection`.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { buildFactsChartSpecs } from "@/lib/article-chart";
import {
  ARTICLE_TOC_CLOSE_TAG,
  ARTICLE_TOC_OPEN_TAG,
  extractHeadings,
} from "@/lib/markdown";
import { createSlugger } from "@/lib/slugify";
import {
  type ExternalContextBundle,
  fetchExternalContext,
} from "@/lib/sources/external-context";
import { type RepoFactsBundle, fetchRepoFacts } from "@/lib/sources/github-repo-facts";

import {
  DATA_NARRATION_ADDENDUM,
  MODEL_NAME,
  profileOutlineAgent,
  profileSectionAgent,
  runNewspaperAgent,
  tutorialSectionAgent,
} from "../agents";
import { stripLeadingHeadingLine } from "../agents/base";
import {
  type GenerationTrace,
  generatorResultSchema,
  generationTraceSchema,
  resolvedAiModelSchema,
} from "../schemas";

/** Same rationale as `CHRONICLE_CONCURRENCY` (`chronicle.ts`): the self-hosted model drops proxy connections under concurrent load. */
export const PROFILE_SECTION_CONCURRENCY = 1;

/**
 * Fixed heading for the code-built data section, which is appended
 * programmatically rather than proposed by the outline agent — that's what
 * guarantees every profile has one and that its charts carry real numbers.
 */
export const DATA_SECTION_HEADING = "By the Numbers";

/**
 * Below this many sections a table of contents is noise, not navigation, so
 * `assembleProfileContent` omits it entirely. Four, i.e. "more than three".
 */
export const PROFILE_TOC_MIN_SECTIONS = 4;

/** What a section's `KIND:` outline line can select. `standard` is the default for every section that omits the line. */
type SectionKind = "standard" | "tutorial";

const sectionKindSchema = z.enum(["standard", "tutorial"]);

const profileInputSchema = z.object({
  /** Source material (a README, notes, transcription — whatever the source processor produced). */
  text: z.string(),
  subjectName: z.string().default(""),
  topicHint: z.string().default(""),
  aiModel: resolvedAiModelSchema.optional(),
  /**
   * `owner/name` when this profile is about a GitHub repository, `""` for
   * every other source type (a profile can also be written from notes, audio,
   * or a calendar event). Empty, or an absent {@link githubToken}, skips
   * `research-repo`'s fetches entirely and the pipeline falls back to
   * README-only behaviour.
   */
  githubRepo: z.string().default(""),
  /** GitHub personal access token, same one `fetchGithubRepoSource` used to build `text`. */
  githubToken: z.string().default(""),
  /** The repo's declared homepage, if any — the seed for `external-context`'s docs-URL heuristics. */
  homepage: z.string().nullable().default(null),
});
export type ProfileWorkflowInput = z.input<typeof profileInputSchema>;

/**
 * Zod mirror of {@link RepoFactsBundle}, needed because the bundle travels
 * through the workflow's validated step boundaries. The `satisfies` clause is
 * the point: if `RepoFactsBundle` ever grows or renames a field, this fails to
 * compile rather than silently dropping it somewhere between two steps.
 */
const repoFactsSchema = z.object({
  languages: z.array(z.object({ name: z.string(), bytes: z.number(), pct: z.number() })),
  metadataOk: z.boolean(),
  stars: z.number(),
  forks: z.number(),
  openIssues: z.number(),
  watchers: z.number(),
  createdAt: z.string(),
  pushedAt: z.string(),
  ageInDays: z.number(),
  license: z.string().nullable(),
  releases: z.object({
    count: z.number(),
    latestTag: z.string().nullable(),
    latestDate: z.string().nullable(),
    cadenceDays: z.number().nullable(),
  }),
  weeklyCommits: z.array(z.number()).nullable(),
}) satisfies z.ZodType<RepoFactsBundle>;

/** What `research-repo` found, recorded for the persisted trace — counts and URLs, not the fetched text itself (which is already in the outline prompt). */
const researchTraceSchema = z.object({
  repo: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  /** `true` only when at least one of the facts sub-fetches actually succeeded (see `factsAreMeaningful`) — a rejected token or an exhausted rate limit degrades every field to its empty/zero value rather than throwing, and that is not "found". */
  factsFound: z.boolean(),
  docsChars: z.number().int(),
  comparisonChars: z.number().int(),
  sourceUrls: z.array(z.string()),
});

/** The research results every later step needs — echoed through the `foreach` the same way `outlineTrace` is, since a `foreach`'s output is just its array. */
const researchContextSchema = z.object({
  facts: repoFactsSchema.nullable(),
  /** Compact plain-text rendering of `facts`, reused verbatim as the data section's source material. */
  factsText: z.string(),
  trace: researchTraceSchema,
});

const researchOutputSchema = profileInputSchema.extend({
  research: researchContextSchema,
});

const outlineTraceSchema = z.object({
  prompt: z.string(),
  response: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
});

/** One outline section, carried through the `foreach` — each job echoes the shared outline fields so `assemble-article` doesn't need separate state passed alongside the array. */
const sectionJobSchema = z.object({
  index: z.number().int(),
  heading: z.string(),
  brief: z.string(),
  kind: sectionKindSchema,
  sourceExcerpt: z.string(),
  premise: z.string(),
  title: z.string(),
  subjectName: z.string(),
  aiModel: resolvedAiModelSchema.optional(),
  outlineTrace: outlineTraceSchema,
  research: researchContextSchema,
});

const sectionOutcomeSchema = z.object({
  index: z.number().int(),
  heading: z.string(),
  brief: z.string(),
  kind: sectionKindSchema,
  ok: z.boolean(),
  markdown: z.string().nullable(),
  prompt: z.string(),
  response: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  error: z.string().nullable(),
  title: z.string(),
  premise: z.string(),
  subjectName: z.string(),
  aiModel: resolvedAiModelSchema.optional(),
  outlineTrace: outlineTraceSchema,
  research: researchContextSchema,
});

/** The code-built data section. Unlike a `sectionOutcome` it has no outline brief — it was never planned by a model. */
const dataSectionSchema = z.object({
  heading: z.string(),
  /** Narration plus the code-generated ` ```chart ` blocks — the final markdown, already heading-stripped. */
  markdown: z.string(),
  ok: z.boolean(),
  prompt: z.string(),
  response: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  error: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Research: facts rendering, source-block assembly
// ---------------------------------------------------------------------------

const emptyExternalContext: ExternalContextBundle = {
  docsText: null,
  comparisonText: null,
  sourceUrls: [],
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** `822` → `"2.3 years"`, for prose that reads like a person wrote it rather than a counter. */
function formatAge(days: number): string {
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round((days / 30.44) * 10) / 10} months`;
  return `${Math.round((days / 365.25) * 10) / 10} years`;
}

/** ISO timestamp → `YYYY-MM-DD`, tolerating the `""` a failed metadata fetch leaves behind. */
function isoDate(value: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/**
 * Render a facts bundle as one compact plain-text line — the `## Background
 * facts` block the outline prompt (`PROFILE_OUTLINE_SYSTEM`) is written
 * expecting, and the data section's entire source material.
 *
 * Only facts that actually came back are mentioned: a repo with no releases
 * says so rather than reporting `null`, and a bundle whose metadata fetch
 * failed (`metadataOk === false`) omits the star/fork/issue/watcher clauses
 * entirely rather than narrating their `0` defaults as real counts — the same
 * flag, and the same reasoning, that gates the matching bar chart in
 * `buildFactsChartSpecs`. This is the *only* place the pipeline turns numbers
 * into text, so the outline agent and the data-narration call cannot be
 * looking at differently-worded versions of the same figures.
 */
export function renderRepoFactsText(facts: RepoFactsBundle): string {
  const parts: string[] = [];

  if (facts.metadataOk) {
    parts.push(
      `Stars: ${formatCount(facts.stars)}`,
      `Forks: ${formatCount(facts.forks)}`,
      `Open issues: ${formatCount(facts.openIssues)}`,
      `Watchers: ${formatCount(facts.watchers)}`,
    );
  }

  if (facts.languages.length > 0) {
    parts.push(
      `Languages: ${facts.languages.map((lang) => `${lang.name} (${lang.pct}%)`).join(", ")}`,
    );
  }
  if (facts.license) parts.push(`License: ${facts.license}`);

  const created = isoDate(facts.createdAt);
  if (created) parts.push(`Created ${created} (${formatAge(facts.ageInDays)} ago)`);
  const pushed = isoDate(facts.pushedAt);
  if (pushed) parts.push(`Last pushed ${pushed}`);

  if (facts.releases.latestTag) {
    const detail = [
      isoDate(facts.releases.latestDate),
      facts.releases.cadenceDays !== null
        ? `~${facts.releases.cadenceDays}-day cadence across the last ${facts.releases.count} releases`
        : null,
    ].filter(Boolean);
    parts.push(
      `Latest release: ${facts.releases.latestTag}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`,
    );
  } else {
    parts.push("No tagged releases");
  }

  if (facts.weeklyCommits && facts.weeklyCommits.length > 0) {
    const weeks = facts.weeklyCommits;
    const total = weeks.reduce((sum, count) => sum + count, 0);
    parts.push(
      `Commits over the last ${weeks.length} weeks: ${formatCount(total)} (${formatCount(weeks[weeks.length - 1])} in the most recent week)`,
    );
  }

  return parts.join(" · ");
}

/**
 * `true` when a facts bundle carries at least one *successfully fetched* piece
 * of data worth writing about — i.e. whether there is a data section to write
 * at all. A bundle where every sub-fetch failed (a rejected token, an exhausted
 * rate limit) has nothing to narrate or chart, and every sub-fetch degrades to
 * its empty/zero value rather than throwing, so "did anything come back" has to
 * be asked per sub-fetch.
 *
 * Each clause below is therefore a success signal, never a value test: the
 * counts are represented by `metadataOk` (the flag `fetchRepoFacts` sets when
 * `repos.get` succeeded) rather than by `stars > 0`, which cannot tell a
 * brand-new repo from a failed request. That makes this function and
 * `buildFactsChartSpecs`'s per-chart gating read from one source of truth:
 * whatever fetch succeeded is real and gets used; whatever failed is absent
 * from the prose and absent from the charts alike.
 */
function factsAreMeaningful(facts: RepoFactsBundle): boolean {
  return (
    facts.metadataOk ||
    facts.languages.length > 0 ||
    (facts.weeklyCommits?.length ?? 0) > 0 ||
    facts.releases.count > 0
  );
}

/**
 * Append the research findings to the source text as separately labeled
 * blocks. The headings are the exact ones `PROFILE_OUTLINE_SYSTEM` names, and
 * they double as `splitSourceIntoChunks` boundaries — which is what lets an
 * outline section say `SOURCE: Documentation` and have
 * `resolveSourceExcerpt` hand that section the docs text and nothing else.
 */
function buildResearchedSourceText(
  baseText: string,
  external: ExternalContextBundle,
  factsText: string,
): string {
  const blocks = [baseText.trim()];
  if (external.docsText) blocks.push(`## Documentation\n\n${external.docsText}`);
  if (external.comparisonText) blocks.push(`## Comparison\n\n${external.comparisonText}`);
  if (factsText) blocks.push(`## Background facts\n\n${factsText}`);
  return blocks.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Outline: prompt, parsing, source chunking
// ---------------------------------------------------------------------------

function withTopicHint(prompt: string, topicHint: string): string {
  return topicHint ? `${prompt}\n\nAdditional focus: ${topicHint}` : prompt;
}

export function buildProfileOutlinePrompt(input: {
  text: string;
  subjectName: string;
  topicHint: string;
}): string {
  const subjectLine = input.subjectName
    ? `The subject of the profile is: ${input.subjectName}.\n\n`
    : "";
  return withTopicHint(
    `${subjectLine}Source material:\n${input.text}\n`,
    input.topicHint,
  );
}

interface ParsedOutlineSection {
  heading: string;
  brief: string;
  sourceRef: string;
  kind: SectionKind;
}

interface ParsedOutline {
  title: string;
  premise: string;
  sections: ParsedOutlineSection[];
}

/**
 * Parses `PROFILE_OUTLINE_SYSTEM`'s plain-text convention. Never throws — an
 * unparseable response just yields zero sections, which the caller treats as a
 * step failure.
 *
 * The `KIND:` line is optional by design (the prompt tells the model to omit
 * it on all but one section), so its absence means `"standard"` rather than a
 * parse problem, and anything that isn't recognisably `tutorial` — a stray
 * `KIND: Tutorial section`, a blank value — also lands on `"standard"`: a
 * misread kind should cost the piece one differently-voiced section, never the
 * whole outline.
 */
export function parseOutline(raw: string): ParsedOutline {
  const lines = raw.trim().split("\n");
  let title = "";
  let premise = "";
  const sections: ParsedOutlineSection[] = [];
  let current: ParsedOutlineSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), brief: "", sourceRef: "", kind: "standard" };
    } else if (line.startsWith("PREMISE:")) {
      premise = line.slice("PREMISE:".length).trim();
    } else if (line.startsWith("BRIEF:") && current) {
      current.brief = line.slice("BRIEF:".length).trim();
    } else if (line.startsWith("SOURCE:") && current) {
      current.sourceRef = line.slice("SOURCE:".length).trim();
    } else if (line.startsWith("KIND:") && current) {
      current.kind = parseSectionKind(line.slice("KIND:".length));
    }
  }
  if (current) sections.push(current);

  return {
    title,
    premise,
    sections: sections.filter((section) => section.heading),
  };
}

/** Lenient `KIND:` value read — case- and whitespace-insensitive, and tolerant of a model that writes `"tutorial / quickstart"` instead of the bare word. */
function parseSectionKind(value: string): SectionKind {
  return value.trim().toLowerCase().includes("tutorial") ? "tutorial" : "standard";
}

interface SourceChunk {
  heading: string;
  text: string;
}

/** Splits markdown-ish source text on its own `#`-`######` headings — READMEs are already structured this way, so this needs no LLM call. */
export function splitSourceIntoChunks(source: string): SourceChunk[] {
  const lines = source.split("\n");
  const chunks: SourceChunk[] = [];
  let current: { heading: string; lines: string[] } = { heading: "Introduction", lines: [] };

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.*)/);
    if (match) {
      chunks.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: match[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  chunks.push({ heading: current.heading, text: current.lines.join("\n").trim() });

  return chunks.filter((chunk) => chunk.text.length > 0);
}

/** Resolves an outline section's `SOURCE:` reference against the source's own chunks; falls back to the whole source (never an empty excerpt) when nothing matches. */
export function resolveSourceExcerpt(
  chunks: SourceChunk[],
  sourceRef: string,
  fullSource: string,
): string {
  if (!sourceRef.trim()) return fullSource;
  const needle = sourceRef.toLowerCase();
  const matches = chunks.filter(
    (chunk) =>
      needle.includes(chunk.heading.toLowerCase()) || chunk.heading.toLowerCase().includes(needle),
  );
  if (matches.length === 0) return fullSource;
  return matches.map((chunk) => `## ${chunk.heading}\n${chunk.text}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Section: prompts
// ---------------------------------------------------------------------------

export function buildProfileSectionPrompt(input: {
  heading: string;
  brief: string;
  premise: string;
  subjectName: string;
  sourceExcerpt: string;
}): string {
  const subjectLine = input.subjectName ? `The subject of the piece is: ${input.subjectName}.\n\n` : "";
  return (
    `${subjectLine}The piece's overall premise: ${input.premise}\n\n` +
    `Write the section titled "${input.heading}". ${input.brief}\n\n` +
    `Source material for this section:\n${input.sourceExcerpt}\n`
  );
}

/**
 * The data section's prompt: the standard per-section prompt over the facts
 * text as its "source material", plus `DATA_NARRATION_ADDENDUM`.
 *
 * Composed here rather than baked into a dedicated agent's `instructions`
 * because there is no dedicated agent — this reuses `profileSectionAgent` in a
 * narration mode, so the "don't invent a number" rule has to ride along with
 * the message.
 */
export function buildDataSectionPrompt(input: {
  premise: string;
  subjectName: string;
  factsText: string;
}): string {
  const base = buildProfileSectionPrompt({
    heading: DATA_SECTION_HEADING,
    brief:
      "Read what these figures say about the project: its size and reach, its language mix, " +
      "how often it ships, and how busy it has been lately. Charts accompanying this section " +
      "are added automatically afterwards, so describe the shape of the numbers rather than " +
      "asking the reader to look at a chart.",
    premise: input.premise,
    subjectName: input.subjectName,
    sourceExcerpt: input.factsText,
  });
  return `${base}\n${DATA_NARRATION_ADDENDUM}\n`;
}

/** Render chart specs as the literal ` ```chart ` fenced blocks `@/lib/markdown` picks up. Code-generated — never model output. */
function renderChartBlocks(specs: ReturnType<typeof buildFactsChartSpecs>): string {
  return specs.map((spec) => `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``).join("\n\n");
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface AssembledSection {
  heading: string;
  /** The section's body, or `null` for a section whose generation failed — which gets a visible placeholder rather than being dropped silently. */
  markdown: string | null;
}

/** The depth `assembleProfileContent` writes its section headings at, and therefore the depth a TOC entry looks for. */
const SECTION_HEADING_DEPTH = 2;

/**
 * Join a premise and a list of sections into the final article markdown, with
 * a table of contents when there are enough sections to justify one.
 *
 * Shared with `regenerateProfileSection` (`@/lib/generation`), which rebuilds
 * the whole article from the persisted trace when one section is retried — if
 * that had its own copy of this logic, a single retry would quietly strip the
 * TOC off an article.
 *
 * Every section body goes through `stripLeadingHeadingLine` on the way in.
 * `write-section` already does that at the write site; doing it again here is
 * belt-and-braces for any path that builds an `AssembledSection` without
 * going through that step (the data section, a hand-edited trace), since this
 * function is what adds the outer `## heading` the stray one would duplicate.
 *
 * ## How the TOC's anchors are kept honest
 *
 * A TOC link only resolves if its `#slug` matches the `id` that
 * `renderMarkdown`'s `heading` renderer will independently stamp on that
 * heading at page-render time, months later. Two things have to agree for that,
 * and both are delegated rather than re-implemented here:
 *
 *   1. *What counts as a heading* — `extractHeadings` (`@/lib/markdown`) runs
 *      the same `marked` lexer the renderer parses with, so an ATX heading
 *      indented three spaces, one inside a blockquote, and a heading-looking
 *      line inside a four-backtick fence are all judged identically on both
 *      sides. (This used to be a local regex plus a hand-rolled fence tracker,
 *      and disagreed with `marked` on every one of those.)
 *   2. *How a heading's text becomes a slug*, collisions included —
 *      `createSlugger()` (`@/lib/slugify`), fed every heading in document
 *      order so the `-2`/`-3` suffixes land in the same places.
 *
 * Which of those headings each TOC entry belongs to is then decided by
 * character offset, not by text: a section body containing a heading whose text
 * matches a *later* section's would otherwise steal that section's entry.
 *
 * The headings are extracted from the article *before* the TOC is inserted,
 * which is safe because the TOC adds no heading of its own: it is a list inside
 * an HTML `<nav>` block, which `marked` passes through while still parsing the
 * markdown links inside it.
 *
 * That `<nav class="article-toc">` wrapper is also what keeps the TOC out of
 * plain-text reductions of the article — `stripMarkdown`/`excerpt` delete the
 * block whole, so a front-page teaser and the TTS narration no longer open by
 * reciting the section list as if it were the opening paragraph.
 */
export function assembleProfileContent(premise: string, sections: AssembledSection[]): string {
  const blocks = sections.map((section) => {
    const body = section.markdown
      ? stripLeadingHeadingLine(section.markdown)
      : "> _This section could not be generated and was skipped — see the generation trace._";
    return `## ${section.heading}\n\n${body}`;
  });

  // Exactly the document the renderer will see, minus the TOC inserted below —
  // and built by concatenation with no trimming, so the block offsets computed
  // alongside it are offsets into this very string. Lexed whole rather than per
  // section, because an unterminated fence in one section's body swallows the
  // next section's heading for `marked` too; the TOC has to inherit that rather
  // than paper over it with a link to an `id` the renderer won't emit.
  const prefix = premise.trim() ? `${premise.trim()}\n\n` : "";
  const article = `${prefix}${blocks.join("\n\n")}`;

  const blockStarts: number[] = [];
  let position = prefix.length;
  for (const block of blocks) {
    blockStarts.push(position);
    position += block.length + "\n\n".length;
  }

  const slugger = createSlugger();
  const slugged = extractHeadings(article).map((heading) => ({
    ...heading,
    slug: slugger(heading.text),
  }));

  // A section's own `## heading` is the first heading falling inside that
  // section's slice of the article — matched by position rather than by text,
  // because a body that happens to contain a heading identical to a later
  // section's would otherwise capture that section's TOC entry and point it at
  // the wrong element. Depth and text are still asserted: if the first heading
  // in the slice isn't the one we wrote (a preceding unterminated fence ate it,
  // or the text didn't survive lexing), the section is left out of the TOC
  // rather than given a link that resolves to nothing.
  const tocLines: string[] = [];
  sections.forEach((section, index) => {
    const start = blockStarts[index];
    const end = index + 1 < blockStarts.length ? blockStarts[index + 1] : article.length;
    const own = slugged.find((heading) => heading.offset >= start && heading.offset < end);
    if (!own || own.depth !== SECTION_HEADING_DEPTH || own.text !== section.heading) return;
    tocLines.push(`- [${section.heading}](#${own.slug})`);
  });

  if (sections.length < PROFILE_TOC_MIN_SECTIONS || tocLines.length === 0) return article.trim();

  const toc = `${ARTICLE_TOC_OPEN_TAG}\n\n${tocLines.join("\n")}\n\n${ARTICLE_TOC_CLOSE_TAG}`;
  return `${prefix}${toc}\n\n${blocks.join("\n\n")}`.trim();
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * No LLM call. Two independent network fetches in parallel, both of which are
 * allowed to come back empty: a profile must still generate from the README
 * alone if GitHub is rate-limiting and every docs guess 404s. `fetchRepoFacts`
 * and `fetchExternalContext` are both written not to throw, so the `.catch`es
 * below are defence against a future edit to either, not a known failure mode.
 */
const researchStep = createStep({
  id: "research-repo",
  description:
    "Gather real external material about the repo — GitHub facts plus any documentation and comparison pages — and fold it into the source text as labeled blocks.",
  inputSchema: profileInputSchema,
  outputSchema: researchOutputSchema,
  execute: async ({ inputData }) => {
    const startedAt = new Date().toISOString();
    const [owner, name] = inputData.githubRepo.split("/");
    const canResearch = Boolean(owner && name && inputData.githubToken);

    let facts: RepoFactsBundle | null = null;
    let external: ExternalContextBundle = emptyExternalContext;

    if (canResearch) {
      const [factsResult, externalResult] = await Promise.all([
        fetchRepoFacts(owner, name, { token: inputData.githubToken }).catch((error: unknown) => {
          console.error(`[profile] Repo facts failed for ${inputData.githubRepo}: ${describe(error)}`);
          return null;
        }),
        fetchExternalContext({ owner, repo: name, homepage: inputData.homepage }).catch(
          (error: unknown) => {
            console.error(
              `[profile] External context failed for ${inputData.githubRepo}: ${describe(error)}`,
            );
            return emptyExternalContext;
          },
        ),
      ]);
      facts = factsResult;
      external = externalResult;
    }

    // A bundle whose every sub-fetch failed — what a rejected token or an
    // exhausted rate limit produces, since each one degrades to its empty/zero
    // value rather than throwing — carries nothing worth narrating or charting,
    // so it is treated as "no facts" from here on. A bundle where only *some*
    // sub-fetches failed still passes: `renderRepoFactsText` and
    // `buildFactsChartSpecs` each omit the parts that didn't come back.
    const usableFacts = facts && factsAreMeaningful(facts) ? facts : null;
    const factsText = usableFacts ? renderRepoFactsText(usableFacts) : "";

    return {
      ...inputData,
      text: buildResearchedSourceText(inputData.text, external, factsText),
      research: {
        facts: usableFacts,
        factsText,
        trace: {
          repo: inputData.githubRepo,
          startedAt,
          endedAt: new Date().toISOString(),
          factsFound: usableFacts !== null,
          docsChars: external.docsText?.length ?? 0,
          comparisonChars: external.comparisonText?.length ?? 0,
          sourceUrls: external.sourceUrls,
        },
      },
    };
  },
});

const buildOutlineStep = createStep({
  id: "build-outline",
  description:
    "Plan a profile article: a headline, a throughline premise, and a set of sections, each pointed at the relevant slice of the source material.",
  inputSchema: researchOutputSchema,
  outputSchema: z.array(sectionJobSchema),
  execute: async ({ inputData }) => {
    const prompt = buildProfileOutlinePrompt(inputData);
    const startedAt = new Date().toISOString();
    const raw = await runNewspaperAgent(profileOutlineAgent, {
      user: prompt,
      aiModel: inputData.aiModel,
    });
    const endedAt = new Date().toISOString();
    const outline = parseOutline(raw);
    if (outline.sections.length === 0) {
      throw new Error("The outline call produced no sections to write.");
    }

    const chunks = splitSourceIntoChunks(inputData.text);
    const outlineTrace = { prompt, response: raw, startedAt, endedAt };
    const title = outline.title || inputData.subjectName || "A Profile of a Notable Project";

    return outline.sections.map((section, index) => ({
      index,
      heading: section.heading,
      brief: section.brief,
      kind: section.kind,
      sourceExcerpt: resolveSourceExcerpt(chunks, section.sourceRef, inputData.text),
      premise: outline.premise,
      title,
      subjectName: inputData.subjectName,
      aiModel: inputData.aiModel,
      outlineTrace,
      research: inputData.research,
    }));
  },
});

/**
 * Whole body in try/catch, not just the model call — a Mastra-level step
 * failure inside a `foreach` calls `killQueue()`, dropping every iteration
 * that hasn't started yet (see `chronicle.ts`'s `write-category-article`,
 * the same pattern, with the full citation). Resolving every error as a
 * normal `{ ok: false }` outcome is what makes "one bad section never
 * touches the others" a property of this step.
 */
const writeSectionStep = createStep({
  id: "write-section",
  description: "Write one section of the profile.",
  inputSchema: sectionJobSchema,
  outputSchema: sectionOutcomeSchema,
  execute: async ({ inputData }) => {
    const prompt = buildProfileSectionPrompt(inputData);
    const startedAt = new Date().toISOString();
    const shared = {
      index: inputData.index,
      heading: inputData.heading,
      brief: inputData.brief,
      kind: inputData.kind,
      prompt,
      title: inputData.title,
      premise: inputData.premise,
      subjectName: inputData.subjectName,
      aiModel: inputData.aiModel,
      outlineTrace: inputData.outlineTrace,
      research: inputData.research,
    };
    try {
      const raw = await runNewspaperAgent(
        inputData.kind === "tutorial" ? tutorialSectionAgent : profileSectionAgent,
        { user: prompt, aiModel: inputData.aiModel },
      );
      return {
        ...shared,
        ok: true,
        // A section writer told "no headline" sometimes writes one anyway;
        // `assemble-article` adds the real `## heading`, so leaving an echoed
        // one in place is what produced visibly duplicated headings.
        markdown: stripLeadingHeadingLine(raw),
        response: raw,
        startedAt,
        endedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      console.error(
        `[profile] section "${inputData.heading}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ...shared,
        ok: false,
        markdown: null,
        response: null,
        startedAt,
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * The one section no model planned and whose charts no model can get wrong:
 * `buildFactsChartSpecs` builds the chart blocks from the facts bundle in
 * code, and the LLM call only supplies surrounding prose over the same
 * numbers rendered as text.
 *
 * It therefore depends on `research-repo`'s output and nothing else — it is
 * sequenced after the section `foreach` purely because that is where the
 * facts bundle is reachable (a `foreach` hands on only its array, so the
 * bundle rides along inside each outcome). Running it here also keeps the
 * `PROFILE_SECTION_CONCURRENCY = 1` property intact: still exactly one
 * in-flight model call at any moment, just one more of them in total.
 *
 * Degrades in both directions. No usable facts at all → no section, rather
 * than an empty one. Facts but a failed narration call → the charts are still
 * emitted on their own, since they needed no model to be correct.
 */
const writeDataSectionStep = createStep({
  id: "write-data-section",
  description: "Narrate the repo's real statistics and append charts built in code from the same numbers.",
  inputSchema: z.array(sectionOutcomeSchema),
  outputSchema: z.object({
    sections: z.array(sectionOutcomeSchema),
    dataSection: dataSectionSchema.nullable(),
  }),
  execute: async ({ inputData }) => {
    const sections = inputData;
    const first = sections[0];
    // Non-null only when at least one of `research-repo`'s facts sub-fetches
    // succeeded — it nulls a wholly-failed bundle itself, and
    // `buildFactsChartSpecs` drops any individual chart whose own sub-fetch
    // failed, so there is no "charted 0 stars" case to guard against here.
    const facts = first?.research.facts ?? null;
    if (!facts) return { sections, dataSection: null };

    const charts = renderChartBlocks(buildFactsChartSpecs(facts));
    const prompt = buildDataSectionPrompt({
      premise: first.premise,
      subjectName: first.subjectName,
      factsText: first.research.factsText,
    });
    const startedAt = new Date().toISOString();

    let narration = "";
    let response: string | null = null;
    let error: string | null = null;
    try {
      response = await runNewspaperAgent(profileSectionAgent, {
        user: prompt,
        aiModel: first.aiModel,
      });
      narration = stripLeadingHeadingLine(response);
    } catch (caught) {
      error = describe(caught);
      console.error(`[profile] data section failed: ${error}`);
    }

    const markdown = [narration, charts].filter(Boolean).join("\n\n");
    if (!markdown) return { sections, dataSection: null };

    return {
      sections,
      dataSection: {
        heading: DATA_SECTION_HEADING,
        markdown,
        ok: error === null,
        prompt,
        response,
        startedAt,
        endedAt: new Date().toISOString(),
        error,
      },
    };
  },
});

/** No LLM call — mechanical join, plus building the `GenerationTrace` persisted alongside the article. */
const assembleArticleStep = createStep({
  id: "assemble-article",
  description: "Join the outline and section drafts into one article, and record the full generation trace.",
  inputSchema: z.object({
    sections: z.array(sectionOutcomeSchema),
    dataSection: dataSectionSchema.nullable(),
  }),
  outputSchema: generatorResultSchema,
  execute: async ({ inputData }) => {
    const { dataSection } = inputData;
    const sorted = [...inputData.sections].sort((a, b) => a.index - b.index);
    const first = sorted[0];

    const content = assembleProfileContent(first.premise, [
      ...sorted.map((section) => ({
        heading: section.heading,
        markdown: section.ok ? section.markdown : null,
      })),
      ...(dataSection ? [{ heading: dataSection.heading, markdown: dataSection.markdown }] : []),
    ]);

    // The data section counts towards success only when it exists: a repo with
    // no usable facts legitimately has none, and that must not read as a
    // partial generation.
    const written = dataSection ? sorted.length + 1 : sorted.length;
    const succeeded = sorted.filter((section) => section.ok).length + (dataSection?.ok ? 1 : 0);
    const status: GenerationTrace["status"] =
      succeeded === written ? "success" : succeeded > 0 ? "partial" : "failed";

    const generationTrace: GenerationTrace = generationTraceSchema.parse({
      workflowId: "profile-deep-dive",
      startedAt: first.research.trace.startedAt,
      endedAt: new Date().toISOString(),
      status,
      research: first.research.trace,
      outline: {
        prompt: first.outlineTrace.prompt,
        response: first.outlineTrace.response,
        title: first.title,
        premise: first.premise,
        startedAt: first.outlineTrace.startedAt,
        endedAt: first.outlineTrace.endedAt,
      },
      sections: [
        ...sorted.map((section) => ({
          index: section.index,
          heading: section.heading,
          brief: section.brief,
          kind: section.kind,
          status: section.ok ? "success" : "failed",
          prompt: section.prompt,
          response: section.response ?? undefined,
          startedAt: section.startedAt,
          endedAt: section.endedAt,
          error: section.error ?? undefined,
        })),
        // The data section's trace `response` is its *final* markdown, charts
        // included — not the raw model text. `regenerateProfileSection`
        // reassembles the whole article from these responses, so anything left
        // out here would vanish from the article the next time any section is
        // retried.
        ...(dataSection
          ? [
              {
                index: sorted.length,
                heading: dataSection.heading,
                brief: "Real repository statistics, narrated, with charts built from the same figures.",
                kind: "data" as const,
                status: dataSection.ok ? ("success" as const) : ("failed" as const),
                prompt: dataSection.prompt,
                response: dataSection.markdown,
                startedAt: dataSection.startedAt,
                endedAt: dataSection.endedAt,
                error: dataSection.error ?? undefined,
              },
            ]
          : []),
      ],
    });

    return {
      title: first.title,
      content,
      category: "Front Page",
      sourceData: {
        generator: "profile-deep-dive",
        model: MODEL_NAME,
        generationTrace,
      },
    };
  },
});

export const profileWorkflow = createWorkflow({
  id: "profile-deep-dive",
  description: "Write a profile/feature article from source material via an outline-then-sections pipeline.",
  inputSchema: profileInputSchema,
  outputSchema: generatorResultSchema,
})
  .then(researchStep)
  .then(buildOutlineStep)
  .foreach(writeSectionStep, { concurrency: PROFILE_SECTION_CONCURRENCY })
  .then(writeDataSectionStep)
  .then(assembleArticleStep)
  .commit();
