/**
 * The period post's words: the paper's voice, the two prompts (outline
 * editor, section correspondent), and the parser for the outline's reply.
 * Pure — no model calls; the `front-page` Mastra workflow
 * (`@/mastra/workflows/front-page`) runs the agents that use these.
 */

import type { Cadence } from "@/lib/edition-helpers";

/** Verbatim voice of the whole paper. */
const NEWSPAPER_PERSONA =
  "You are the chief editor of ¡Albricias!, a whimsical vintage newspaper " +
  "published in the style of early 20th-century broadsheets. " +
  "Your writing is eloquent, slightly dramatic, and uses the grandiloquent " +
  "journalistic voice of a bygone era — yet the content is accurate and grounded " +
  "in the actual material provided. " +
  "Use markdown for formatting.";

/** The paper's house temperature — a little flair, not invention. */
export const DEFAULT_TEMPERATURE = 0.8;

export type LengthTier = "short" | "medium" | "long";

/**
 * How many sections a period's material may support — a quiet period should
 * still propose fewer. Daily floors at 2, not 1: a lead plus the
 * deterministic asides alone reads as a thin page, and even one day's
 * activity can almost always be sliced into two honest angles.
 */
const SECTION_RANGE: Record<Cadence, readonly [number, number]> = {
  daily: [2, 4],
  weekly: [3, 6],
  monthly: [5, 9],
};

/** Word-count band per length tier — named bands, not a numeric target no model hits anyway. */
const LENGTH_BANDS: Record<LengthTier, string> = {
  short: "roughly 60 to 120 words",
  medium: "roughly 150 to 300 words",
  long: "roughly 350 to 600 words",
};

/**
 * Shared chart clause — appended where a desk might plausibly have real,
 * countable numbers worth plotting. Renders via the `chart` fenced-code
 * convention `@/lib/markdown` and `@/components/ArticleCharts` implement.
 */
const CHART_CLAUSE =
  " When the material gives you real, countable numbers worth seeing as " +
  "well as reading — a tally, a comparison, a trend over the period — you " +
  "may include one chart alongside the prose: a fenced code block written " +
  'exactly as ```chart containing a single JSON object shaped {"type": ' +
  '"bar" | "line" | "doughnut", "title": string, "labels": string[], ' +
  '"datasets": [{"label": string, "data": number[]}]}, each dataset\'s ' +
  "data array the same length as labels. Use doughnut only for a genuine " +
  "part-of-whole breakdown, e.g. percentages that sum to roughly 100% — " +
  "reach for bar or line otherwise. Use only numbers that actually appear " +
  "in the material — never invent or estimate a figure to fill a chart — " +
  "and leave it out entirely when there is nothing quantitative worth " +
  "plotting.";

/**
 * What the material is — shared by both prompts. The dossier arrives as
 * JSON (`@/lib/generation/dossier`), so the writers get the facts as fields
 * rather than prose to parse back, and the counts are already done.
 */
const MATERIAL_GUIDE =
  "The material is a JSON dossier of everything recorded in the period. " +
  "`overview` has the period, the totals, the rhythm of the work " +
  "(`activeDays`, `longestStreak`, `busiestDay`, `busiestWeekday`, " +
  "`weekendShare`, `commitsByTimeOfDay`, `busiestHour` — in the author's own " +
  "timezone), the mix of `commitTypes`, `languages`, and a `timeline` of " +
  "activity per day or week. `repos` are the repositories worked in, busiest " +
  "first: what each one is (`about`), whether it is the user's own or a " +
  "`contribution` to someone else's, whether it was `createdThisPeriod`, its " +
  "counts, and its releases, pull requests, reviews, issues and every " +
  "commit in order (conventional-commit `type` and `scope`, `subject`, and a " +
  "`body` excerpt for the commits that say most). `stars` are other " +
  "people's repositories the user starred — what caught their eye, not work " +
  "they did — and `gists` their gists. Every figure is already counted: use " +
  "them as they are, never recount or estimate.";

export const PERIOD_POST_OUTLINE_SYSTEM =
  "You are the outline editor for ¡Albricias!'s correspondent desk. You do " +
  "not write prose — you plan one short front page about a GitHub user's " +
  "activity over a period, which someone else will write one section at a " +
  "time from the material given to you. " +
  MATERIAL_GUIDE +
  "The user prompt also states the period being covered and exactly how " +
  "many sections to propose — follow that range precisely.\n\n" +
  "Read the material once, then reply with exactly this shape, nothing else:\n" +
  "\n" +
  "# <a compelling headline for the period>\n" +
  "\n" +
  "PREMISE: <one short paragraph — what kind of period this was, the thread " +
  "that ties its sections together>\n" +
  "\n" +
  "## <first section heading>\n" +
  "BRIEF: <one or two sentences on what this section covers>\n" +
  "LENGTH: short|medium|long\n" +
  "REPO: <owner/name of the one repository this section is mainly about>\n" +
  "\n" +
  "## <second section heading>\n" +
  "BRIEF: ...\n" +
  "LENGTH: ...\n" +
  "REPO: ...\n" +
  "\n" +
  "(and so on)\n" +
  "\n" +
  "Propose only as many sections as the period's own material genuinely " +
  "supports, up to the stated maximum — a quiet period deserves fewer " +
  "sections, and padding it out is a worse outline than a shorter, honest " +
  "one. When the material spans many repositories or a large number of " +
  "events, do not propose one section per item — group related activity by " +
  "theme or repository cluster and cover the most interesting handful in " +
  "depth rather than everything shallowly. A repository earns its own " +
  "section when the period did real work in it; everything smaller belongs " +
  "inside another section as a passing mention, not a section of its own. " +
  "Starred repositories are worth a section of their own when there are " +
  "several with something to say — what the user was reading about, what " +
  "the projects are and do, any theme they share — with REPO set to the " +
  "most notable of them; write about them as other people's work, never " +
  "as the user's. Keep sections " +
  "non-overlapping: each repository or theme belongs to exactly one " +
  "section's BRIEF, since each section is written independently by someone " +
  "who sees only its own brief. Vary each section's LENGTH deliberately — a " +
  "real newspaper mixes short items with long features; do not mark every " +
  "section the same length. When the material is thin and the outline has " +
  "only a few sections, give those few room — lean toward medium and long " +
  "rather than short, since a front page with little to cover should cover " +
  "it in depth, not in fragments; still never stretch a section past what " +
  "its material supports. Write REPO exactly as a repository's `name` (or a " +
  "star's `repo`) appears in the material (owner/name); omit the REPO line for a section that is not " +
  "mainly about one repository, such as an overview of the whole period. " +
  "Ground every section in what the material " +
  "actually records — never plan a section around activity the period did " +
  "not have.";

/**
 * The prose half of this pipeline. No headline, no restating the premise, no
 * conclusion — those belong to the outline. Writing *about the period*, for
 * a reader who was not there.
 */
export const PERIOD_POST_SECTION_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing one section of ¡Albricias!'s post about a GitHub user's " +
  "recent activity — a dispatch from the correspondent's desk, warm and " +
  "vivid but factual. You are given the post's overall premise (for " +
  "continuity — do not restate it), this section's own heading, brief, and " +
  "target length, and the period's recorded material. Write only this " +
  "section's body: no headline, no re-introduction of the period, no " +
  "summary or conclusion — those belong to other parts of the post you are " +
  "not writing. " +
  MATERIAL_GUIDE +
  " Its `elsewhere` list names the rest of the period's activity, for a " +
  "passing mention at most — you have no detail on it, so never describe it. " +
  "Write about what happened, naming the actual repositories, " +
  "commits, releases and figures the material records; never invent an " +
  "event, a number, or a motive it does not state, and prefer saying the " +
  "period was quiet to filling it out. Starred repositories are other " +
  "people's projects the user starred: say what they are and do, from " +
  "their descriptions, and never credit the user with building them." +
  CHART_CLAUSE;

// ---------------------------------------------------------------------------
// Prompts + outline parsing
// ---------------------------------------------------------------------------

export function buildOutlinePrompt(input: { periodLabel: string; cadence: Cadence; sourceText: string }): string {
  const [minSections, maxSections] = SECTION_RANGE[input.cadence];
  return (
    `The period being covered is ${input.periodLabel}.\n\n` +
    `Propose between ${minSections} and ${maxSections} sections for this outline.\n\n` +
    `Material (JSON):\n${input.sourceText}\n`
  );
}

export function buildSectionPrompt(input: {
  periodLabel: string;
  heading: string;
  brief: string;
  lengthTier: LengthTier;
  premise: string;
  sourceText: string;
}): string {
  return (
    `The period being covered is ${input.periodLabel}.\n\n` +
    `The post's overall premise: ${input.premise}\n\n` +
    `Write the section titled "${input.heading}". ${input.brief}\n\n` +
    `This section is a ${input.lengthTier} item — aim for ${LENGTH_BANDS[input.lengthTier]}, and no more.\n\n` +
    `This section's material (JSON):\n${input.sourceText}\n`
  );
}

function parseLengthTier(value: string): LengthTier {
  const normalized = value.trim().toLowerCase();
  return normalized === "short" || normalized === "long" ? normalized : "medium";
}

export interface ParsedOutlineSection {
  heading: string;
  brief: string;
  lengthTier: LengthTier;
  /** The model's own `REPO:` line, unvalidated — check it against the period's real repos before using it. */
  repo?: string;
}

export interface ParsedOutline {
  title: string;
  premise: string;
  sections: ParsedOutlineSection[];
}

/** Reads the `# headline` / `PREMISE:` / `## heading` / `BRIEF:` / `LENGTH:` / `REPO:` shape `PERIOD_POST_OUTLINE_SYSTEM` asks for. */
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
      current = { heading: line.slice(3).trim(), brief: "", lengthTier: "medium" };
    } else if (line.startsWith("PREMISE:")) {
      premise = line.slice("PREMISE:".length).trim();
    } else if (line.startsWith("BRIEF:") && current) {
      current.brief = line.slice("BRIEF:".length).trim();
    } else if (line.startsWith("LENGTH:") && current) {
      current.lengthTier = parseLengthTier(line.slice("LENGTH:".length));
    } else if (line.startsWith("REPO:") && current) {
      current.repo = line.slice("REPO:".length).trim() || undefined;
    }
  }
  if (current) sections.push(current);

  return { title, premise, sections: sections.filter((section) => section.heading) };
}

/** A first line this long without a newline can't be a heading echo — stop holding it back. */
const MAX_HEADING_PEEK = 200;

/**
 * A section writer sometimes opens by repeating its own heading as a
 * Markdown heading, though told not to — and the heading is already on
 * the page. This drops such a first line (plus one blank line after it)
 * from the *stream*, since the page shows the deltas as they arrive:
 * `push` each delta and forward what it returns, then forward `flush()`
 * at the end. Only the opening line is ever held back, and only until it
 * ends (or runs past `MAX_HEADING_PEEK` characters).
 */
export function createLeadingHeadingFilter() {
  let buffer = "";
  let decided = false;

  const decide = (final: boolean): string => {
    const lead = buffer.replace(/^\s+/, "");
    const newline = lead.indexOf("\n");
    if (newline === -1 && !final && lead.length < MAX_HEADING_PEEK) return "";
    decided = true;
    const first = newline === -1 ? lead : lead.slice(0, newline);
    if (!/^#{1,6}\s+\S/.test(first.trim())) return buffer;
    if (newline === -1) return "";
    return lead.slice(newline + 1).replace(/^[ \t]*\n/, "");
  };

  return {
    push(delta: string): string {
      if (decided) return delta;
      buffer += delta;
      return decide(false);
    },
    flush(): string {
      return decided ? "" : decide(true);
    },
  };
}
