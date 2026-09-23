import type { NextRequest } from "next/server";

/**
 * The public-facing origin a redirect should target, not necessarily
 * `request.url`'s own origin.
 *
 * `request.url`'s origin is built from the `Host` header Next.js's own
 * process actually received — behind a reverse proxy that proxies to this
 * container without rewriting `Host` to the public domain (a common `nginx`
 * gotcha: a `proxy_pass` with no `proxy_set_header Host $host;`), that's the
 * proxy's internal address (often `localhost`), not the domain the browser
 * is actually on. Redirecting to that address sends the browser to an
 * address only reachable from inside the deployment, not to the user.
 *
 * `X-Forwarded-Host`/`X-Forwarded-Proto` are the standard way a reverse
 * proxy communicates the original, public-facing host — prefer them when
 * present (matches how Next's own CSRF check already treats `Host` and
 * `X-Forwarded-Host` as equally trustworthy, see the Server Actions guide),
 * falling back to `request.url`'s origin for a direct, non-proxied setup.
 */
export function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return new URL(request.url).origin;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${forwardedProto}://${forwardedHost}`;
}
