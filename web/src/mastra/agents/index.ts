/**
 * Mastra agents backing the period-post generation pipeline.
 *
 * Forked from the old day-scoped `dayPostOutlineAgent`/`dayPostSectionAgent`
 * (day-post.ts), generalized from "a single day" to "a period" (daily,
 * weekly, or monthly) — the exact section-count range and period label are
 * stated in the per-request user prompt (`@/mastra/workflows/period-post`),
 * not hardcoded here, so these instructions stay period-agnostic.
 */

import { Agent } from "@mastra/core/agent";

import { MODEL_ID, NEWSPAPER_PERSONA } from "./base";

/**
 * Shared chart clause — appended where a desk might plausibly have real,
 * countable numbers worth plotting. Renders via the `chart` fenced-code
 * convention `@/lib/markdown` and `@/components/ArticleCharts` implement.
 * The "never invent a figure" line matters more here than almost anywhere
 * else in these prompts: a wrong number in prose reads as an odd sentence, a
 * wrong number in a chart reads as fact.
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

export const PERIOD_POST_OUTLINE_SYSTEM =
  "You are the outline editor for ¡Albricias!'s correspondent desk. You do " +
  "not write prose — you plan one short front page about a GitHub user's " +
  "activity over a period, which someone else will write one section at a " +
  "time from the material given to you. The material arrives as a single " +
  "labeled block, \"## Activity\", listing everything recorded in the " +
  "period — commits, pull requests, issues, releases, stars, and so on. " +
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
  "\n" +
  "## <second section heading>\n" +
  "BRIEF: ...\n" +
  "\n" +
  "(and so on)\n" +
  "\n" +
  "Propose only as many sections as the period's own material genuinely " +
  "supports, up to the stated maximum — a quiet period deserves fewer " +
  "sections, and padding it out is a worse outline than a shorter, honest " +
  "one. A repository earns its own section when the period did real work in " +
  "it or starred it with something substantial to say; everything smaller " +
  "belongs inside another section as a passing mention, not a section of " +
  "its own. Keep sections non-overlapping: each repository or theme belongs " +
  "to exactly one section's BRIEF, since each section is written " +
  "independently by someone who sees only its own brief. Ground every " +
  "section in what the material actually records — never plan a section " +
  "around activity the period did not have.";

/**
 * The prose half of `@/mastra/workflows/period-post`. Same per-section
 * scoping as before (no headline, no restating the premise, no conclusion —
 * those belong to the outline/assembly) — writing *about the period*, for a
 * reader who was not there, rather than surveying a project's whole history.
 */
export const PERIOD_POST_SECTION_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing one section of ¡Albricias!'s post about a GitHub user's " +
  "recent activity — a dispatch from the correspondent's desk, warm and " +
  "vivid but factual. You are given the post's overall premise (for " +
  "continuity — do not restate it), this section's own heading and brief, " +
  "and the period's recorded material. Write only this section's body: no " +
  "headline, no re-introduction of the period, no summary or conclusion — " +
  "those belong to other parts of the post you are not writing. Write " +
  "about what happened, naming the actual repositories, commits, releases " +
  "and figures the material records; never invent an event, a number, or a " +
  "motive it does not state, and prefer saying the period was quiet to " +
  "filling it out. Aim for roughly 150 to 400 words — a section that runs " +
  "long is padding it." +
  CHART_CLAUSE;

export const periodPostOutlineAgent = new Agent({
  id: "period-post-outline",
  name: "Albricias Correspondent Desk — Outline",
  description:
    "Plans one period's post: decides which repos and activity earn their own section. Writes no prose.",
  instructions: PERIOD_POST_OUTLINE_SYSTEM,
  model: MODEL_ID,
});

export const periodPostSectionAgent = new Agent({
  id: "period-post-section",
  name: "Albricias Correspondent Desk — Section Writer",
  description: "Writes one section of a period's post from its own brief and the period's recorded activity.",
  instructions: PERIOD_POST_SECTION_SYSTEM,
  model: MODEL_ID,
});

/**
 * No newspaper voice — a trivial, cheap call that proves the configured
 * provider/model actually answers a request. Not currently wired to a UI
 * action; kept as a cheap primitive a future "test your key" button on the
 * `/app` config form could call via `runNewspaperAgent`.
 */
export const connectionTestAgent = new Agent({
  id: "connection-test",
  name: "Connection Test",
  description: "Answers a trivial prompt to verify an AI provider is reachable and authenticated.",
  instructions: "Reply with the single word OK.",
  model: MODEL_ID,
});

/** Registered on the Mastra instance in `src/mastra/index.ts`. */
export const agents = {
  periodPostOutline: periodPostOutlineAgent,
  periodPostSection: periodPostSectionAgent,
  connectionTest: connectionTestAgent,
};
