/**
 * Editor login. Ported from `app/templates/login.html` and the GET half of
 * `public.login` (`app/routes/public.py:24-34`).
 *
 * Flask handled both verbs on one endpoint and used `flash()` to surface a bad
 * password. Here the form posts to `/api/login`, which redirects back with
 * `?error=1` on failure — the same single visible outcome, without needing a
 * flash-message store.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import { safeNextPath } from "@/lib/safe-redirect";
import { hasAdminPassword } from "@/lib/config/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Editor Login - ¡Albricias!" };

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!(await hasAdminPassword())) {
    redirect("/setup");
  }

  const query = await searchParams;
  const nextPath = safeNextPath(firstValue(query.next));
  const failed = firstValue(query.error) !== undefined;

  return (
    <NewspaperShell endpoint="public.login">
      <div className="max-w-md mx-auto my-12 fade-in">
        <div className="border-4 border-ink p-8 bg-paper shadow-lg relative">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-ink"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-ink"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-ink"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-ink"></div>

          <div className="text-center mb-8">
            <h2 className="font-masthead text-4xl mb-2">Editor Access</h2>
            <div className="border-b border-ink border-double w-24 mx-auto mb-4"></div>
            <p className="font-sans text-xs uppercase tracking-widest text-ink-light">
              Authorized Personnel Only
            </p>
          </div>

          {failed && (
            <div className="mb-6 p-3 border border-red-800 bg-red-50 text-red-800 text-sm font-serif italic text-center">
              Invalid password
            </div>
          )}

          <form method="POST" action="/api/login" className="space-y-6">
            <input type="hidden" name="next" value={nextPath} />
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-sans font-bold uppercase tracking-widest mb-2"
              >
                Access Code
              </label>
              <input
                type="password"
                name="password"
                id="password"
                required
                className="w-full bg-transparent border-2 border-ink px-4 py-3 font-serif focus:ring-0 focus:border-ink-light transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-ink text-paper py-3 font-sans font-bold uppercase tracking-widest hover:bg-ink-light transition-colors"
            >
              Enter Newsroom
            </button>
          </form>

          <div className="mt-8 text-center">
            <div className="border-t border-ink border-dotted pt-4">
              <p className="font-serif text-xs italic text-stone-500">
                &quot;Accuracy is to a newspaper what virtue is to a lady.&quot;
              </p>
            </div>
          </div>
        </div>
      </div>
    </NewspaperShell>
  );
}
