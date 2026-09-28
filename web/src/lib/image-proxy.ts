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
 * configure). With neither set (both are optional — a visitor can supply
 * their own GitHub token instead), a fixed fallback would be the same
 * guessable string on every such instance, letting anyone forge a
 * signature and use the proxy to fetch arbitrary public URLs; instead one
 * random key is generated at boot and kept for the process's life —
 * signed URLs just stop verifying across a restart, which nothing else
 * depends on (nothing is stored). The route fetches only URLs that
 * verify, through `safeFetch`'s public-internet-only rules.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const bootSecret = randomBytes(32).toString("hex");

function key(): Buffer {
  const secret = process.env.IMAGE_PROXY_SECRET || (process.env.GITHUB_TOKEN ? `albricias-image-proxy:${process.env.GITHUB_TOKEN}` : bootSecret);
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
