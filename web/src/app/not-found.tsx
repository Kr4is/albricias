/**
 * Ported from `app/templates/404.html`, which the Flask app rendered both from
 * its `app_errorhandler(404)` and directly from the home/edition/article routes
 * when nothing matched (`app/routes/public.py:56`, `:166`, `:216`).
 * `notFound()` in those pages reaches this file with the same 404 status.
 */

import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";

export const metadata: Metadata = { title: "Page Not Found - Albricias" };

export default function NotFound() {
  return (
    <NewspaperShell endpoint="public.page_not_found">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="font-masthead text-8xl mb-4">404</h1>
        <h2 className="font-headline text-3xl font-bold mb-4">
          Edition Not Found
        </h2>
        <p className="font-body text-lg text-stone-600 mb-8 max-w-md">
          We regret to inform you that the requested edition could not be located
          in our archives.
        </p>
        <a
          href="/archive"
          className="inline-flex items-center font-sans text-sm font-bold uppercase tracking-widest text-ink border border-ink px-6 py-3 hover:bg-ink hover:text-white transition-colors"
        >
          <span className="material-icons mr-2 text-lg">archive</span>
          Browse Our Archives
        </a>
      </div>
    </NewspaperShell>
  );
}
