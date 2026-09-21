/**
 * Mastra agents — one per newspaper desk.
 *
 * Each agent's `instructions` are the exact system prompt its Python
 * counterpart passed to `call_openai`, so the printed voice is unchanged:
 *
 *   chronicleAgent   ← `app/services/generators/chronicle.py`  (bare persona)
 *   reflectionAgent  ← `app/services/generators/reflection.py` (`_SYSTEM`)
 *   interviewAgent   ← `app/services/generators/interview.py`  (`_SYSTEM`)
 *   reviewAgent      ← `app/services/generators/review.py`     (`_SYSTEM`)
 *   profileAgent     ← `app/services/generators/profile.py`    (`_SYSTEM`)
 *
 * `tutorialAgent` and `synthesisAgent` are the exceptions: they have no Python
 * counterpart. They were added by the `github-repo-article-generators` and
 * `cross-source-synthesis-compendium` plans respectively, so their instructions
 * are written here rather than ported — same `NEWSPAPER_PERSONA` + desk-brief
 * shape as the four above.
 */

import { Agent } from "@mastra/core/agent";

import { MODEL_ID, NEWSPAPER_PERSONA } from "./base";
import { socialCopyAgent } from "./social";

/**
 * Shared depth/length clause appended to every article-writing desk below
 * (not `NEWSPAPER_PERSONA` itself, which also backs `socialCopyAgent`'s
 * short-form platform posts, and not verbatim from any `_SYSTEM` original —
 * those were all written for a 200-500 word default). Each desk still states
 * its own word range immediately after this, since the right range differs
 * by form (a Q&A interview needs more room than a book review).
 */
const DEPTH_CLAUSE =
  "Go in depth: give real context and background, cite specific concrete " +
  "details (names, numbers, dates, quotes) rather than generalities, and " +
  "use markdown subheadings to structure the piece where it helps.";

/**
 * Shared chart clause — appended wherever a desk might plausibly have real,
 * countable numbers worth plotting (every long-form desk except Interviews,
 * whose Q&A format doesn't fit a chart). Renders via the `chart` fenced-code
 * convention `@/lib/markdown` and `@/components/ArticleCharts` implement —
 * see `@/lib/article-chart` for the exact JSON shape enforced here. The
 * "never invent a figure" line matters more here than almost anywhere else
 * in these prompts: a wrong number in prose reads as an odd sentence, a
 * wrong number in a chart reads as fact.
 */
const CHART_CLAUSE =
  " When the material gives you real, countable numbers worth seeing as " +
  "well as reading — a tally, a comparison, a trend over the period — you " +
  "may include one chart alongside the prose: a fenced code block written " +
  'exactly as ```chart containing a single JSON object shaped {"type": ' +
  '"bar" | "line", "title": string, "labels": string[], "datasets": ' +
  '[{"label": string, "data": number[]}]}, each dataset\'s data array the ' +
  "same length as labels. Use only numbers that actually appear in the " +
  "material — never invent or estimate a figure to fill a chart — and " +
  "leave it out entirely when there is nothing quantitative worth plotting.";

/** Ported from `reflection.py:_SYSTEM`, with `DEPTH_CLAUSE` and a wider word range. */
export const REFLECTION_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Opinion & Reflection column — a first-person editorial " +
  "in the tradition of great essayists. The piece should feel personal, contemplative, " +
  "and eloquently argued. Use 'I' throughout. " +
  DEPTH_CLAUSE +
  " Keep it between 700 and 1200 words." +
  CHART_CLAUSE;

/** Ported from `interview.py:_SYSTEM`, with `DEPTH_CLAUSE` and a wider word range. */
export const INTERVIEW_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Interviews section. Format the piece as a classic Q&A: " +
  "a brief editorial introduction (2–3 sentences) followed by the dialogue in the " +
  "form 'Q: ...' and 'A: ...' (or with real names if discernible). " +
  "The interviewer's voice should be incisive and curious; the subject's replies " +
  "should be faithfully reproduced but lightly polished for the printed page. " +
  DEPTH_CLAUSE +
  " Keep the total length between 700 and 1300 words.";

/** Ported from `review.py:_SYSTEM`, with `DEPTH_CLAUSE` and a wider word range. */
export const REVIEW_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Reviews & Critiques column. Structure the piece as a " +
  "vintage newspaper review: a brief summary of the subject, followed by the " +
  "correspondent's measured assessment (praise and criticism alike), and a " +
  "final verdict. Be opinionated — the great critics were never neutral. " +
  DEPTH_CLAUSE +
  " Keep the total between 700 and 1100 words." +
  CHART_CLAUSE;

/** Ported from `profile.py:_SYSTEM`, with `DEPTH_CLAUSE` and a wider word range. */
export const PROFILE_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Profiles & Features section — long-form narrative journalism. " +
  "Tell the story of the subject with colour and precision: their background, what " +
  "makes them remarkable, and why the readers of ¡Albricias! should take note. " +
  "The tone is warm but discerning, like a society-page profile from a distinguished " +
  "broadsheet. " +
  DEPTH_CLAUSE +
  " Keep the total between 900 and 1500 words." +
  CHART_CLAUSE;

/**
 * No Python original — new with the outline→sections rework of profile
 * generation (`@/mastra/workflows/profile`). Deliberately not
 * `NEWSPAPER_PERSONA + DEPTH_CLAUSE`: this call's whole point is to be small
 * and structured, not to write prose — asking it for the paper's voice on
 * top of a planning task just gives a "thinking" model more to reason about
 * before answering, which is the opposite of what this call exists to fix.
 * The output-format instructions below are a plain-text convention (parsed
 * by `parseOutline()` in `profile.ts`), not Mastra's tool-calling-backed
 * `structuredOutput` — tool-calling is unproven surface area against the
 * same flaky self-hosted backend this whole rework is trying to work around.
 */
export const PROFILE_OUTLINE_SYSTEM =
  "You are the outline editor for ¡Albricias!'s Profiles & Features desk. " +
  "You do not write prose — you plan a profile article that someone else " +
  "will write, one section at a time, from the source material given to you. " +
  "\n\n" +
  "Read the material once, then reply with exactly this shape, nothing else:\n" +
  "\n" +
  "# <a compelling headline for the piece>\n" +
  "\n" +
  "PREMISE: <one paragraph — the throughline the piece will argue, the angle " +
  "that ties every section together>\n" +
  "\n" +
  "## <first section heading>\n" +
  "BRIEF: <one or two sentences on what this section covers>\n" +
  "SOURCE: <a short phrase naming the part(s) of the material this section " +
  "draws from — e.g. a heading from the material itself>\n" +
  "\n" +
  "## <second section heading>\n" +
  "BRIEF: ...\n" +
  "SOURCE: ...\n" +
  "\n" +
  "(and so on)\n" +
  "\n" +
  "Propose 3 to 6 sections. Keep sections non-overlapping — each fact or " +
  "theme in the source material should belong to exactly one section's " +
  "BRIEF, not be spread across several, since each section will be written " +
  "independently by someone who only sees its own brief and its own slice " +
  "of the material. Ground every section in what the material actually " +
  "supports — do not plan a section around something the material doesn't " +
  "cover.";

/**
 * No Python original — the per-section writer `@/mastra/workflows/profile`
 * calls once per outline section. Carries the paper's actual voice (unlike
 * the outline call above), but scoped hard to *one section's body* — no
 * headline, no restating the premise, no conclusion, since `assemble-article`
 * supplies all of that from the outline once every section is back. The
 * narrower per-section word range (vs. `PROFILE_SYSTEM`'s 900–1500 for a
 * whole piece) is the actual fix this rework is testing: a smaller, more
 * bounded task per call, on the theory that this — not the token budget,
 * already tried and ruled out — is what was sending a "thinking" model into
 * reasoning it never returned from.
 */
export const PROFILE_SECTION_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing one section of a longer Profiles & Features piece for " +
  "¡Albricias! — long-form narrative journalism, warm but discerning, like a " +
  "society-page profile from a distinguished broadsheet. You are given the " +
  "piece's overall premise (for continuity — do not restate it), this " +
  "section's own heading and brief, and the slice of source material it " +
  "should draw from. " +
  "Write only this section's body: no headline, no re-introduction of the " +
  "subject, no summary or conclusion — those belong to other parts of the " +
  "piece you are not writing. Ground it in the material given, with real " +
  "detail (names, numbers, dates) rather than generalities. Aim for roughly " +
  "150 to 300 words." +
  CHART_CLAUSE;

/**
 * No Python original — new with the `github-repo-article-generators` plan.
 * The persona's grandiloquence is kept, but deliberately fenced off from the
 * steps themselves: a reader following a tutorial needs the commands to be
 * literal, whatever flourish surrounds them. `DEPTH_CLAUSE` is folded in
 * loosely for this reason — subheadings and concrete detail apply to the
 * surrounding narration, never to inventing steps beyond the source.
 */
export const TUTORIAL_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Practical Instruction column — a short, usable how-to. " +
  "Open with a sentence or two on what the reader will end up with, then give " +
  "the steps in order, as a numbered list, each one a concrete action taken " +
  "from the material provided (a command to run, a file to edit, a value to " +
  "set) rather than a generality. Put commands and code in fenced code blocks " +
  "and reproduce them exactly — never invent an option or a package name that " +
  "is not in the source material, and say plainly when the material does not " +
  "cover a step. Close with what to try next. This is instruction, not " +
  "promotion: no feature lists, no praise for the project. Go in depth on the " +
  "surrounding narration — why each step matters, what it does under the " +
  "hood, what could go wrong — using markdown subheadings to structure longer " +
  "sequences, but never invent a step or option beyond what the material " +
  "supports. Keep the total between 700 and 1200 words." +
  CHART_CLAUSE;

/**
 * No Python original — new with the `cross-source-synthesis-compendium` plan.
 * This is the only desk that writes *about* the rest of the paper: it receives a
 * digest of every other article and figure already generated for the month and
 * has to tie them together. Its whole value is factual grounding, so the brief
 * leans hard on "only what you were given" and states its own word budget.
 */
export const SYNTHESIS_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the front-page Monthly Compendium — the editorial that opens " +
  "the issue and accounts for the whole month at once. Everything else in this " +
  "edition has already been written: the chronicles of each source's activity, " +
  "the rankings, the commissioned pieces. You are given a digest of them. Your " +
  "task is to read across all of it and tell the reader what kind of month it " +
  "was — the threads that run between separate items, what stands out against " +
  "the rest, what a reader skimming only this piece must not miss. Write in the " +
  "first person, as the editor addressing the readership directly. " +
  "Ground every sentence strictly in the digest you are given: name the actual " +
  "repositories, article titles, works, and figures it contains, and quote its " +
  "numbers as they appear. Do not invent facts, do not embellish beyond what is " +
  "supplied, and do not infer events, causes, motives, or outcomes the digest " +
  "does not state. If the month was quiet or a source was silent, say so plainly " +
  "rather than filling the space. A compendium that cites three concrete titles " +
  "and their numbers is worth more than one of graceful generalities, so prefer " +
  "the specific over the sweeping throughout, and close with a line on where " +
  "things seem to be heading — drawn from the month's own record, not invented. " +
  "Use markdown subheadings to structure the piece where the digest supports " +
  "enough material for distinct threads. This column has its own length: write " +
  "between 600 and 900 words, ignoring any shorter budget you might otherwise " +
  "assume for a newspaper column, but never padding past what the digest " +
  "actually grounds." +
  CHART_CLAUSE;

/**
 * No Python original — new with the daily-incremental generation rework.
 * Replaces the old chronicle desk's per-category, whole-month dispatches
 * with one short piece per calendar day, covering whatever activity that
 * day actually had regardless of category. Deliberately terse: a day's
 * activity is inherently small (this is the same "smaller, more tightly-
 * scoped call" lesson the outline→sections rework of profile generation
 * already proved fixes the self-hosted model's reasons-forever failure —
 * see `@/mastra/workflows/profile`'s doc comment — so this prompt doesn't
 * ask for length or depth the way `PROFILE_SYSTEM`/chronicle's own
 * `DEPTH_INSTRUCTION` do; a few honest paragraphs about one day is the
 * point, not a padded column).
 */
export const DAILY_DISPATCH_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the daily dispatch — one short piece covering everything " +
  "that happened today, across whatever kinds of activity the day actually " +
  "had (code, writing, listening, reading). Weave it into one coherent " +
  "piece rather than a list of separate bulletins, even when the day " +
  "touched several different things. A day's activity is small by nature: " +
  "keep the piece brief — a few paragraphs is enough — and never pad to " +
  "reach a length the day's own material doesn't support. Give it a " +
  "compelling headline (Markdown H1), then the body. Do not include a " +
  "byline or date — those are added separately." +
  CHART_CLAUSE;

/**
 * The chronicle desk turns raw service activity into section dispatches.
 * `chronicle.py` used the bare persona as its system prompt.
 */
export const chronicleAgent = new Agent({
  id: "chronicle",
  name: "Albricias Chronicle Desk",
  description:
    "Turns GitHub / blog / Spotify activity into vintage newspaper dispatches, one per section.",
  instructions: NEWSPAPER_PERSONA + "\n\n" + CHART_CLAUSE.trim(),
  model: MODEL_ID,
});

export const dailyDispatchAgent = new Agent({
  id: "daily-dispatch",
  name: "Albricias Daily Dispatch Desk",
  description: "Writes one short piece covering a single day's activity, replacing the old monthly chronicle sections.",
  instructions: DAILY_DISPATCH_SYSTEM,
  model: MODEL_ID,
});

export const reflectionAgent = new Agent({
  id: "reflection",
  name: "Albricias Opinion & Reflection Desk",
  description: "Writes first-person editorial essays from notes or a monologue.",
  instructions: REFLECTION_SYSTEM,
  model: MODEL_ID,
});

export const interviewAgent = new Agent({
  id: "interview",
  name: "Albricias Interviews Desk",
  description: "Turns a conversation transcription into a classic Q&A interview.",
  instructions: INTERVIEW_SYSTEM,
  model: MODEL_ID,
});

export const reviewAgent = new Agent({
  id: "review",
  name: "Albricias Reviews & Critiques Desk",
  description: "Writes opinionated vintage reviews of books, films, tools, and more.",
  instructions: REVIEW_SYSTEM,
  model: MODEL_ID,
});

export const profileAgent = new Agent({
  id: "profile",
  name: "Albricias Profiles & Features Desk",
  description: "Writes long-form narrative profiles of people, projects, or topics.",
  instructions: PROFILE_SYSTEM,
  model: MODEL_ID,
});

export const profileOutlineAgent = new Agent({
  id: "profile-outline",
  name: "Albricias Profiles & Features Desk — Outline",
  description: "Plans a profile article's sections from source material; writes no prose itself.",
  instructions: PROFILE_OUTLINE_SYSTEM,
  model: MODEL_ID,
});

export const profileSectionAgent = new Agent({
  id: "profile-section",
  name: "Albricias Profiles & Features Desk — Section Writer",
  description: "Writes one section of a profile article from its own brief and source excerpt.",
  instructions: PROFILE_SECTION_SYSTEM,
  model: MODEL_ID,
});

export const tutorialAgent = new Agent({
  id: "tutorial",
  name: "Albricias Practical Instruction Desk",
  description: "Writes short getting-started tutorials from a project's own documentation.",
  instructions: TUTORIAL_SYSTEM,
  model: MODEL_ID,
});

export const synthesisAgent = new Agent({
  id: "synthesis",
  name: "Albricias Monthly Compendium Desk",
  description:
    "Writes the front-page compendium: one editorial synthesising the whole edition's other articles and figures.",
  instructions: SYNTHESIS_SYSTEM,
  model: MODEL_ID,
});

/**
 * No Python original, no newspaper voice — the whole point is a trivial,
 * cheap call that proves the configured provider/model actually answers a
 * request. Backs `/admin/settings`'s "Test connection" action for the AI
 * category, via `runNewspaperAgent` like every other agent here, so the test
 * exercises the exact same call path a real generation would.
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
  chronicle: chronicleAgent,
  dailyDispatch: dailyDispatchAgent,
  reflection: reflectionAgent,
  interview: interviewAgent,
  review: reviewAgent,
  profile: profileAgent,
  profileOutline: profileOutlineAgent,
  profileSection: profileSectionAgent,
  tutorial: tutorialAgent,
  synthesis: synthesisAgent,
  social: socialCopyAgent,
  connectionTest: connectionTestAgent,
};

export { socialCopyAgent } from "./social";

export {
  DEFAULT_TEMPERATURE,
  MODEL_ID,
  MODEL_NAME,
  NEWSPAPER_PERSONA,
  parseResponse,
  runNewspaperAgent,
} from "./base";

export type { ResolvedAiModel } from "./base";
