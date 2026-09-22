/**
 * Heading slugs, shared by exactly two callers that must never disagree:
 * `@/lib/markdown`'s `heading` renderer (which stamps `id="<slug>"` onto every
 * rendered `<h1>`–`<h6>`) and `@/mastra/workflows/profile`'s `assemble-article`
 * step (which writes the table-of-contents links `- [Heading](#<slug>)` at the
 * top of a profile article).
 *
 * Those two live on opposite sides of the pipeline — one runs at generation
 * time and bakes its output into the stored markdown, the other runs at render
 * time on every page view — so a TOC link and its target heading only resolve
 * if both derive the slug from *this* function. Two independent
 * implementations, however similar-looking, is exactly how anchors silently
 * rot apart later; hence one module with no other purpose.
 *
 * `slugify` is pure. Collision handling ("Getting Started" twice in one
 * article) needs per-document state, so it lives in {@link createSlugger}
 * rather than in a module-level counter — a module-level one would leak dedup
 * state between unrelated articles (article B's first "Overview" becoming
 * `overview-2` because article A had one earlier in the process's life).
 */

/**
 * `"Getting  Started!!"` → `"getting-started"`. Accents are folded to ASCII
 * (`"Añadir"` → `"anadir"`) so a Spanish heading — this paper writes plenty —
 * still yields a usable ASCII fragment identifier. Anything that reduces to
 * nothing at all (a heading of pure punctuation or CJK, which NFKD can't fold)
 * falls back to `"section"`, so the emitted `id`/`href` is never empty.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining diacritics left behind by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * A slug function scoped to one document: identical heading text seen a second
 * time gets `-2`, a third `-3`, and so on, matching GitHub's own convention.
 *
 * Call this once per document (one `renderMarkdown()` call, one assembled
 * article) and use the returned function for every heading in it, in document
 * order — the suffixes depend on call order, so the TOC builder and the
 * renderer only agree while both walk the same headings in the same sequence.
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = slugify(text);
    const used = seen.get(base) ?? 0;
    seen.set(base, used + 1);
    return used === 0 ? base : `${base}-${used + 1}`;
  };
}
