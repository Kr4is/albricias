/**
 * Guard for the `?next=` parameter the login flow round-trips.
 *
 * Flask handed `request.args.get("next")` straight to `redirect()`
 * (`app/routes/public.py:32`), which happily follows an absolute URL — an open
 * redirect. Only same-origin, path-absolute targets are accepted here; anything
 * else falls back to the home page, which is also what Flask did when `next`
 * was missing.
 */

export function safeNextPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next) return fallback;
  // Must be a site-relative path, and must not be protocol-relative
  // ("//evil.example") or a backslash variant browsers normalise to one.
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
