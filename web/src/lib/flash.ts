/**
 * Query-param flash messages for admin routes — the equivalent of Flask's
 * `flash()` / `get_flashed_messages()`, without a server-side message store.
 *
 * Generalises the `?error=1` flag `/api/login` already uses: a redirect can
 * carry any number of messages, each with a category, as parallel `flash` /
 * `flashType` query params. Pages read them back with {@link readFlash} and
 * render them with `@/components/admin/FlashBanner`.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export type FlashType = "success" | "error" | "warning" | "info";

export interface FlashMessage {
  type: FlashType;
  text: string;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Read flash messages out of a page's resolved `searchParams`. */
export function readFlash(
  params: Record<string, string | string[] | undefined>,
): FlashMessage[] {
  const texts = toArray(params.flash);
  const types = toArray(params.flashType);
  return texts.map((text, index) => ({
    text,
    type: (types[index] as FlashType | undefined) ?? "info",
  }));
}

/** Append flash messages to a URL as parallel `flash` / `flashType` params. */
function withFlash(url: URL, messages: FlashMessage[]): URL {
  for (const message of messages) {
    url.searchParams.append("flash", message.text);
    url.searchParams.append("flashType", message.type);
  }
  return url;
}

/**
 * Redirect to `path` (resolved against `request`) carrying `messages` as
 * flash query params. Uses 303 so the browser re-issues the follow-up as GET,
 * matching the rest of this codebase's POST-then-redirect routes.
 */
export function flashRedirect(
  request: NextRequest,
  path: string,
  messages: FlashMessage[],
  status = 303,
): NextResponse {
  const url = withFlash(new URL(path, request.url), messages);
  return NextResponse.redirect(url, status);
}

/** Human-readable message from a caught error, matching the sources' local `describe()` helpers. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
