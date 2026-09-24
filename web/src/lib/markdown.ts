/**
 * Markdown rendering for article bodies, replacing Jinja's `| markdown | safe`
 * filter (`app/extensions.py:14-16`, python-markdown with the `fenced_code`
 * and `tables` extensions).
 *
 * `marked` covers both of those out of the box (GFM fenced code + tables).
 * Like the Flask original the output is trusted and injected unescaped —
 * article bodies are written by the single admin user or produced by the
 * generation pipeline, never by anonymous visitors.
 *
 * One addition on top of stock GFM: a ` ```chart ` fenced block (see
 * `@/lib/article-chart` for the JSON contract inside it, and `CHART_CLAUSE`
 * in `@/lib/generation/period-post` for the prompt instruction that tells
 * generators when to use it) renders as a placeholder `<div data-chart>` instead of a code
 * block — `@/components/ArticleCharts` finds those client-side and draws
 * them with Chart.js. A block that fails to parse as a valid chart spec
 * falls through to marked's normal code-block rendering (`return false`),
 * so a malformed one degrades to a visible code block instead of vanishing.
 */

import { Marked, type Token, type Tokens } from "marked";
import { parseArticleChartSpec } from "./article-chart";
import { createSlugger } from "./slugify";

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
});

/**
 * The wrapper the profile pipeline's table of contents is emitted inside (see
 * `assembleProfileContent` in `@/mastra/workflows/profile`).
 *
 * It exists because a TOC is navigation, not prose: rendered to HTML it must
 * stay a list of working anchors, but every *plain-text* reduction of an
 * article — front-page teasers via {@link excerpt}, the TTS narration script
 * via {@link stripMarkdown} — has to drop it whole. A bare markdown list
 * can't express that difference (`stripMarkdown` turns `[Text](#slug)` into
 * `Text`, so the narration read the entire TOC aloud as a sentence). An HTML
 * block can: `marked` passes the `<nav>` tags through untouched and still
 * parses the markdown list inside them, while the two functions below
 * recognise the container and delete it.
 */
export const ARTICLE_TOC_OPEN_TAG = '<nav class="article-toc">';
export const ARTICLE_TOC_CLOSE_TAG = "</nav>";

/** Matches a whole {@link ARTICLE_TOC_OPEN_TAG} block, contents included. */
const ARTICLE_TOC_BLOCK_RE = /<nav class="article-toc">[\s\S]*?<\/nav>/gi;

/**
 * Per-document slug state for the `heading` renderer below.
 *
 * `marked.use()` registers one renderer object for the lifetime of the module,
 * but heading-collision suffixes (`-2`, `-3`) must only dedupe *within* one
 * article — a module-level `createSlugger()` would carry state across every
 * article the process ever renders. So `renderMarkdown()` swaps in a fresh
 * slugger before each parse. That's safe without any locking precisely because
 * this `Marked` instance is configured `async: false`: `marked.parse()` runs to
 * completion synchronously, so no second `renderMarkdown()` call can interleave
 * with one in progress and steal its slugger.
 */
let activeSlugger = createSlugger();

marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang !== "chart") return false;
      const spec = parseArticleChartSpec(text);
      if (!spec) return false;
      const encoded = Buffer.from(JSON.stringify(spec), "utf-8").toString("base64");
      return `<div class="article-chart" data-chart="${encoded}"></div>`;
    },
    /**
     * Stock `marked` emits `<h2>Heading</h2>` with no `id`, so nothing in an
     * article could be linked to. This adds the `id`, slugged by the same
     * `@/lib/slugify` the profile pipeline's table-of-contents builder uses —
     * see that module's header for why both sides must share one function.
     *
     * `token.text` (the heading's raw markdown) is what gets slugged, while
     * the visible text still goes through `parseInline` so inline formatting
     * inside a heading keeps rendering as before.
     */
    heading(token) {
      const id = activeSlugger(token.text);
      return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
    },
  },
});

export function renderMarkdown(text: string | null | undefined): string {
  activeSlugger = createSlugger();
  return marked.parse(text ?? "") as string;
}

/** One heading as the `heading` renderer above will see it — same `depth`, same raw `text` that gets slugged. */
export interface ExtractedHeading {
  depth: number;
  text: string;
  /**
   * Where this heading starts in the markdown it was extracted from — exact for
   * a top-level heading, and the start of the enclosing top-level block for one
   * nested inside a blockquote or list item (`marked` reports a nested token's
   * `raw` relative to its already-unwrapped container, so a finer offset isn't
   * available; the block's own start is enough to say which part of a document
   * the heading belongs to, which is all any caller needs it for).
   */
  offset: number;
}

/**
 * Collect the heading tokens reachable from one block token, in the order
 * `marked`'s own `Parser` reaches them. Recursion mirrors `Parser.parse`'s
 * container cases exactly — a blockquote parses its `tokens`, a list parses
 * each item's `tokens` — which is how a heading nested in either still lands in
 * document order. Inline token lists (a heading's or paragraph's own `tokens`)
 * are not descended into: a heading cannot occur inside one.
 */
function collectHeadings(token: Token, out: ExtractedHeading[], offset: number): void {
  if (token.type === "heading") {
    const heading = token as Tokens.Heading;
    out.push({ depth: heading.depth, text: heading.text, offset });
    return;
  }
  if (token.type === "blockquote") {
    for (const child of (token as Tokens.Blockquote).tokens ?? []) {
      collectHeadings(child, out, offset);
    }
  } else if (token.type === "list") {
    for (const item of (token as Tokens.List).items ?? []) {
      for (const child of item.tokens ?? []) collectHeadings(child, out, offset);
    }
  }
}

/**
 * Every heading in `markdown`, in document order, as decided by the very
 * parser that will render it.
 *
 * This exists so the profile pipeline's table-of-contents builder
 * (`assembleProfileContent`, `@/mastra/workflows/profile`) and the `heading`
 * renderer above agree on *what counts as a heading* — not just on how a
 * heading's text is slugged (that's `@/lib/slugify`'s job). The TOC used to
 * re-implement heading detection with its own regex plus a hand-rolled
 * fence tracker, which disagreed with `marked` on ATX headings indented one to
 * three spaces, headings inside blockquotes, and heading-looking lines inside a
 * four-backtick fence. Any single disagreement desynchronises the shared
 * slug-collision counter and every anchor after it points at the wrong element.
 * One lexer, one answer.
 */
export function extractHeadings(markdown: string): ExtractedHeading[] {
  const headings: ExtractedHeading[] = [];
  // Every top-level token's `raw` concatenated back together reproduces the
  // input exactly (a `marked` invariant its own parser depends on), so summing
  // their lengths as we go gives each token's true character offset.
  let offset = 0;
  for (const token of marked.lexer(markdown ?? "")) {
    collectHeadings(token, headings, offset);
    offset += token.raw?.length ?? 0;
  }
  return headings;
}

/**
 * Strip common Markdown formatting down to plain text — for anywhere a
 * short excerpt or a narration script needs the words without the syntax,
 * as opposed to `renderMarkdown()`'s full HTML for a page. Originally
 * TTS-only (`@/lib/tts.ts`); moved here once the front-page issue layouts
 * needed the same thing for article teasers, so both have one definition.
 *
 * A table-of-contents block (see {@link ARTICLE_TOC_OPEN_TAG}) is removed
 * whole, before links are flattened — otherwise the TOC's `[Heading](#slug)`
 * entries collapse into their bare heading text and a teaser or a narration
 * script opens by reciting the article's own section list as prose.
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(ARTICLE_TOC_BLOCK_RE, " ") // table-of-contents nav: navigation, never prose
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks (chart blocks included)
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/^\|.*\|[ \t]*$/gm, "") // GFM table rows (header, separator, and data rows alike — meaningless without their column headers once truncated into a teaser)
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2") // bold+italic
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/^\s*([-*_]\s*){3,}$/gm, "") // horizontal rules
    .replace(/^\s*[-*+]\s+/gm, "") // bullet list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/\n{3,}/g, "\n\n") // collapse extra blank lines
    .trim();
}

/**
 * A plain-text excerpt of `markdown`, safe to drop into a front-page teaser
 * `<p>` — Markdown syntax stripped first (so `##`/`**`/`` ``` `` never show
 * up literally, the bug this was written to fix), then clipped at the last
 * word boundary before `maxChars` with a trailing ellipsis, only when it was
 * actually truncated.
 */
export function excerpt(markdown: string | null | undefined, maxChars: number): string {
  const plain = stripMarkdown(markdown ?? "").replace(/\s+/g, " ").trim();
  if (plain.length <= maxChars) return plain;
  const clipped = plain.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}
