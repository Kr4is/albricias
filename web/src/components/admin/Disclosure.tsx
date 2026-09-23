/**
 * Collapsed-by-default reveal for admin pages that otherwise dump a lot of
 * detail at once (e.g. the raw GitHub stats bank on the edition edit page).
 * Native `<details>/<summary>` — no client JS for the reveal itself, works
 * with SSR, matches the app's minimal-JS ethos (see `NewspaperShell`'s
 * form-intercept script for the one place client JS is used at all).
 *
 * `persistKey`, when set, opts this instance into that same script's
 * open/closed persistence: native `<details>` otherwise forgets its `open`
 * state on every full page load, which loses e.g. which admin-dashboard row
 * was expanded the moment a form on the page submits and reloads it. Pass a
 * key unique across the page (an id, an action URL — anything stable and
 * distinct per instance); omit it for a one-off reveal where that would be
 * meaningless (there's only ever one, so there's nothing to "remember").
 *
 * `disclosure-anim` (defined in `globals.css`) animates the open/close via the
 * native `::details-content` pseudo-element. The usual `grid-template-rows:
 * 0fr/1fr` accordion trick does *not* work here: a closed `<details>` has its
 * content `display: none`d by the UA, so there is no "from" state to
 * interpolate and the row snaps open (measured, Chrome 153). Browsers without
 * `::details-content` simply keep today's instant show/hide.
 */

export default function Disclosure({
  summary,
  defaultOpen = false,
  persistKey,
  children,
}: {
  /** A plain label, or richer content (e.g. a title + status badge) — kept non-interactive, per `<summary>`'s own constraints; put buttons/links/forms in `children` instead. */
  summary: React.ReactNode;
  defaultOpen?: boolean;
  /** Unique-per-page key to remember this instance's open/closed state across reloads (see above). */
  persistKey?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      className="disclosure-anim group border border-stone-200 bg-white"
      data-persist-key={persistKey}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="cursor-pointer select-none marker:hidden [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2 px-4 py-3 text-[10px] font-sans font-bold uppercase tracking-widest text-stone-600 hover:bg-stone-50 transition-colors">
        {summary}
        <span className="material-icons text-sm text-stone-400 transition-transform group-open:rotate-180">
          expand_more
        </span>
      </summary>
      <div className="px-4 pb-4 border-t border-stone-100">{children}</div>
    </details>
  );
}
