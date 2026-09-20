/**
 * Collapsed-by-default reveal for admin pages that otherwise dump a lot of
 * detail at once (e.g. the raw GitHub stats bank on the edition edit page).
 * Native `<details>/<summary>` — no client JS, works with SSR, matches the
 * app's minimal-JS ethos (see `NewspaperShell`'s form-intercept script for
 * the one place client JS is used at all).
 */

export default function Disclosure({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group border border-stone-200 bg-white"
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
