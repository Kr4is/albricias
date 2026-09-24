/**
 * Period-post generation — outline → per-section drafts, plain async
 * functions calling the Vercel AI SDK directly (no workflow framework).
 *
 * Given one already-fetched batch of GitHub activity for a period, produces
 * the sections of a front page. Nothing here reads or writes anything —
 * this is a one-shot, in-memory pipeline with no cross-run history.
 *
 * Both the outline and each section use `streamText`, not `generateText` —
 * a blocking call sits silent until the whole response is ready, which is
 * exactly what trips a reverse proxy's idle/response timeout in front of a
 * slow self-hosted model. The outline's stream is drained internally and
 * never shown (it's control syntax — headline/premise/section briefs in a
 * fixed format, not prose anyone should watch typed out); each section's
 * stream is forwarded live via `onDelta`, so the caller (the SSE route) can
 * show it being written token by token.
 */

import { streamText, type LanguageModel } from "ai";
import { describeAiError } from "@/lib/ai/error";

/** Verbatim voice of the whole paper. */
export const NEWSPAPER_PERSONA =
  "You are the chief editor of ¡Albricias!, a whimsical vintage newspaper " +
  "published in the style of early 20th-century broadsheets. " +
  "Your writing is eloquent, slightly dramatic, and uses the grandiloquent " +
  "journalistic voice of a bygone era — yet the content is accurate and grounded " +
  "in the actual material provided. " +
  "Use markdown for formatting.";

const DEFAULT_TEMPERATURE = 0.8;

type Cadence = "daily" | "weekly" | "monthly";
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

export const PERIOD_POST_OUTLINE_SYSTEM =
  "You are the outline editor for ¡Albricias!'s correspondent desk. You do " +
  "not write prose — you plan one short front page about a GitHub user's " +
  "activity over a period, which someone else will write one section at a " +
  "time from the material given to you. The material is a dossier of " +
  "everything recorded in the period: an overview (counts, active days, " +
  "languages), a dossier per repository worked in (what the repository is, " +
  "then its releases with notes, pull requests with their state, issues, " +
  "reviews and commit messages), the repositories starred (what each one " +
  "is — other people's projects that caught the user's eye), and gists. " +
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
  "its material supports. Write REPO exactly as the repository appears in " +
  "the material (owner/name); omit the REPO line for a section that is not " +
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
  "not writing. Write about what happened, naming the actual repositories, " +
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
    `Material:\n${input.sourceText}\n`
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
    `The period's material:\n${input.sourceText}\n`
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

/** Strip a leading Markdown heading line (any level, any text) plus one following blank line, if present. */
export function stripLeadingHeadingLine(markdown: string): string {
  const trimmed = markdown.trim();
  const lines = trimmed.split("\n");
  const first = lines[0]?.trim() ?? "";

  if (!/^#{1,6}\s+\S/.test(first)) return trimmed;

  let rest = lines.slice(1);
  if (rest[0]?.trim() === "") rest = rest.slice(1);

  return rest.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Outline + sections
// ---------------------------------------------------------------------------

interface TextResult {
  text: string;
  finishReason: string;
}

/** A response too broken to use: cut off mid-generation, or nothing at all. */
function isUnusable(result: TextResult): boolean {
  return result.finishReason === "length" || !result.text.trim();
}

export async function buildOutline(input: {
  periodLabel: string;
  cadence: Cadence;
  sourceText: string;
  model: LanguageModel;
}): Promise<ParsedOutline> {
  const prompt = buildOutlinePrompt(input);
  // maxRetries: 0 — the AI SDK's own retry wrapper (3 attempts by default)
  // both adds several seconds of backoff before a real failure surfaces and
  // discards the underlying error's detail (statusCode, response body) when
  // it gives up, leaving only a bare, sometimes-empty message. This call
  // already has its own retry-once for the specific "truncated/empty"
  // failure mode just below; a hard API error (bad key, network) should
  // surface immediately, with its real detail intact.
  //
  // streamText, not generateText — even though nothing here is forwarded to
  // the client (the outline is control syntax, not prose anyone should
  // watch typed out). A *blocking* call sits silent until the whole
  // response is ready; behind a reverse proxy in front of a slow
  // self-hosted model (Cloudflare, in front of a LiteLLM gateway, most
  // concretely) that silence is exactly what trips its idle/response
  // timeout (a 524). A streamed call keeps bytes flowing the moment the
  // model emits its first token, which keeps the proxy from ever seeing a
  // silent connection — same reason `writeSection` below streams.
  const call = async (): Promise<TextResult> => {
    // `onError` is a side channel for the *real* underlying error — when a
    // request fails before any chunk arrives, the SDK's own `text`/
    // `finishReason` promises can reject with a generic
    // "No output generated" instead of the actual cause. Prefer whatever
    // `onError` captured, when it did.
    let capturedError: unknown;
    const { textStream, text, finishReason } = streamText({
      model: input.model,
      system: PERIOD_POST_OUTLINE_SYSTEM,
      prompt,
      temperature: DEFAULT_TEMPERATURE,
      maxRetries: 0,
      onError: ({ error }) => {
        capturedError = error;
      },
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- draining only, deltas aren't shown
      for await (const _delta of textStream) {
        // Discarded — consuming the stream is what keeps the connection alive.
      }
      return { text: await text, finishReason: await finishReason };
    } catch (error) {
      throw capturedError ?? error;
    }
  };

  let result = await call();
  if (isUnusable(result)) {
    console.warn(`[period-post] outline truncated/empty (finishReason: ${result.finishReason}) — retrying once`);
    result = await call();
  }
  if (isUnusable(result)) {
    throw new Error(
      `The outline call returned a truncated/empty response twice in a row (finishReason: ${result.finishReason}). ` +
        "The provider may be enforcing its own token ceiling, or the model may be failing silently.",
    );
  }

  const outline = parseOutline(result.text);
  // A weak model (small local Ollama models in particular) can produce real
  // prose while still missing the exact "## heading" / "BRIEF:" shape this
  // parses for — falling back to one section over the whole period, rather
  // than failing the entire generation, degrades gracefully instead of
  // punishing the visitor for a model they chose that can write but can't
  // follow a structured multi-field format.
  if (outline.sections.length === 0) {
    outline.sections = [{ heading: outline.title || input.periodLabel, brief: "Cover the period's activity as a whole.", lengthTier: "medium" }];
  }
  if (!outline.title) outline.title = input.periodLabel;
  return outline;
}

/**
 * Write one section, forwarding live text deltas to `onDelta` as they arrive.
 *
 * No retry on truncation here (unlike the outline call): by the time a
 * truncated/empty response is detected, partial text has already been
 * streamed to the client — a silent retry would either leave stale text on
 * screen or need a new "restart this section" signal, not worth it for one
 * call. Throws instead; the caller drops the section (see the route).
 * `ponytail: no retry on streamed truncation — revisit only if it turns out common enough to need a section-restart event.`
 */
export async function writeSection(
  input: {
    heading: string;
    brief: string;
    lengthTier: LengthTier;
    premise: string;
    periodLabel: string;
    sourceText: string;
    model: LanguageModel;
  },
  onDelta: (delta: string) => void,
): Promise<string> {
  const prompt = buildSectionPrompt(input);
  // maxRetries: 0 — see the same note on the outline call above; a failure
  // here should surface immediately with its real detail, not after several
  // seconds of silent backoff. `onError` — same reason as the outline call:
  // a side channel for the real error, since a failure before any chunk can
  // otherwise surface via `text`/`finishReason` as a generic
  // "No output generated" instead of the actual cause.
  let capturedError: unknown;
  const { textStream, text, finishReason } = streamText({
    model: input.model,
    system: PERIOD_POST_SECTION_SYSTEM,
    prompt,
    temperature: DEFAULT_TEMPERATURE,
    maxRetries: 0,
    onError: ({ error }) => {
      capturedError = error;
    },
  });

  let finalText: string;
  let reason: string;
  try {
    for await (const delta of textStream) onDelta(delta);
    [finalText, reason] = await Promise.all([text, finishReason]);
  } catch (error) {
    throw new Error(`Section "${input.heading}" stream failed: ${describeAiError(capturedError ?? error)}`);
  }

  if (reason === "length" || !finalText.trim()) {
    throw new Error(`Section "${input.heading}" truncated/empty (finishReason: ${reason}).`);
  }
  return stripLeadingHeadingLine(finalText);
}
