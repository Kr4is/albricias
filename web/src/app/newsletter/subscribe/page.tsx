/**
 * Newsletter subscribe form. New in the agent-editions/social/newsletter
 * plan — no Flask equivalent. Styled after `/login` (same bordered-card
 * layout from `app/templates/login.html`'s vintage vocabulary).
 *
 * Also doubles as the landing page for `/newsletter/confirm/[token]` and
 * `/newsletter/unsubscribe/[token]`, and as the redirect target for the
 * subscribe CTA embedded in `@/components/Footer` on every public page — so
 * this is the one page guaranteed to render whatever flash message any of
 * those flows leaves behind.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { readFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Newsletter - ¡Albricias!" };

export default async function NewsletterSubscribePage({
  searchParams,
}: PageProps<"/newsletter/subscribe">) {
  const query = await searchParams;
  const messages = readFlash(query);

  return (
    <NewspaperShell endpoint="public.newsletter_subscribe">
      <div className="max-w-md mx-auto my-12 fade-in">
        <div className="border-4 border-ink p-8 bg-paper shadow-lg relative">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-ink"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-ink"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-ink"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-ink"></div>

          <div className="text-center mb-8">
            <h2 className="font-masthead text-4xl mb-2">The Newsletter</h2>
            <div className="border-b border-ink border-double w-24 mx-auto mb-4"></div>
            <p className="font-sans text-xs uppercase tracking-widest text-ink-light">
              New editions, delivered to your inbox
            </p>
          </div>

          <FlashBanner messages={messages} />

          <form method="POST" action="/newsletter/subscribe/create" className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-sans font-bold uppercase tracking-widest mb-2"
              >
                Email Address
              </label>
              <input
                type="email"
                name="email"
                id="email"
                required
                className="w-full bg-transparent border-2 border-ink px-4 py-3 font-serif focus:ring-0 focus:border-ink-light transition-colors"
                placeholder="reader@example.com"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-ink text-paper py-3 font-sans font-bold uppercase tracking-widest hover:bg-ink-light transition-colors"
            >
              Subscribe
            </button>
          </form>

          <div className="mt-8 text-center">
            <div className="border-t border-ink border-dotted pt-4">
              <p className="font-serif text-xs italic text-stone-500">
                One email per edition. Unsubscribe anytime, no account needed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </NewspaperShell>
  );
}
