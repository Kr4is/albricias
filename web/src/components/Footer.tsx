/**
 * Newsletter subscribe CTA, shown at the bottom of every public page
 * (`@/components/NewspaperShell`, admin pages excluded). New in the
 * agent-editions/social/newsletter plan — no `base.html` equivalent — kept
 * deliberately small so it doesn't disturb the existing masthead/`<main>`
 * markup the Phase 4 rewrite protects pixel parity for.
 *
 * Posts straight to `/newsletter/subscribe/create`, which always redirects
 * back to `/newsletter/subscribe` regardless of which page hosted the form —
 * see that route's doc comment for why.
 */

export default function Footer() {
  return (
    <footer className="border-t-4 border-double border-ink mt-10 pt-6 pb-8 px-6 sm:px-8 lg:px-10 text-center no-print">
      <p className="font-masthead text-xl mb-1">Never Miss an Edition</p>
      <p className="font-sans text-[11px] uppercase tracking-widest text-stone-500 mb-4">
        New editions, delivered to your inbox
      </p>
      <form
        method="POST"
        action="/newsletter/subscribe/create"
        className="flex flex-col sm:flex-row gap-2 max-w-sm mx-auto"
      >
        <input
          type="email"
          name="email"
          required
          placeholder="your@email.com"
          aria-label="Email address"
          className="flex-1 min-w-0 bg-transparent border-2 border-ink px-3 py-2 text-sm font-serif focus:ring-0 focus:border-ink-light transition-colors"
        />
        <button
          type="submit"
          className="bg-ink text-paper px-5 py-2 text-xs font-sans font-bold uppercase tracking-widest hover:bg-ink-light transition-colors"
        >
          Subscribe
        </button>
      </form>
    </footer>
  );
}
