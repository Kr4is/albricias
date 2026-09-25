/**
 * The page shows every picture through the app's own `/api/image` — never
 * straight from where it lives. Two reasons: a README's images live on
 * hosts that don't send CORS headers, and the PNG export can only embed
 * same-origin (or CORS) images; and the page must only ever load pictures
 * the workflow chose, not whatever URL someone puts in a query string.
 *
 * So each proxied URL carries an HMAC of its target, signed with a key
 * only the server knows (`IMAGE_PROXY_SECRET`, or else one derived from
 * `GITHUB_TOKEN` — the same on every instance, with nothing new to
 * configure). The route fetches only URLs that verify, through
 * `safeFetch`'s public-internet-only rules. Stateless: nothing is stored.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function key(): Buffer {
  const secret = process.env.IMAGE_PROXY_SECRET || `albricias-image-proxy:${process.env.GITHUB_TOKEN ?? ""}`;
  return createHash("sha256").update(secret).digest();
}

function sign(target: string): string {
  return createHmac("sha256", key()).update(target).digest("base64url");
}

/** The same-origin URL the page loads `target` from. */
export function proxiedImageUrl(target: string): string {
  return `/api/image?u=${encodeURIComponent(target)}&s=${sign(target)}`;
}

/** Whether `signature` is this server's for `target`. */
export function verifyImageUrl(target: string, signature: string): boolean {
  const expected = Buffer.from(sign(target));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
