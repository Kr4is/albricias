/**
 * Fetching a URL someone else chose — an image in a README, a project's
 * homepage — from the server, without letting that URL reach anything but
 * the public internet. A README is anyone's to write, so a URL in one may
 * point at `localhost`, a cloud metadata address or the host's own
 * network; every hop (redirects included, followed by hand) must be
 * `https`, on the standard port, and resolve only to public addresses. The
 * body is capped and the whole fetch timed out.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeFetchOptions {
  /** Largest body accepted, in bytes. */
  maxBytes: number;
  timeoutMs: number;
  accept?: string;
}

export interface SafeFetchResult {
  url: string;
  contentType: string;
  body: Uint8Array;
}

const MAX_REDIRECTS = 3;

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges — anything that isn't the public internet. */
function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return false;
  if (v6.startsWith("::ffff:")) return isPublicAddress(v6.slice(7));
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff")) return false;
  return true;
}

/** Throws unless `url` is an `https` URL on the default port whose host resolves only to public addresses. */
async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) {
    throw new Error(`not a public https URL: ${url.origin}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new Error(`${host} isn't a public host`);
}

/** Fetches `raw` under the rules in the header; throws on anything else. */
export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = new URL(raw);
  for (let hop = 0; ; hop += 1) {
    await assertPublic(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { accept: options.accept ?? "*/*", "user-agent": "albricias (+https://github.com/Kr4is/albricias)" },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      await response.body?.cancel();
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (declared > options.maxBytes) {
      await response.body.cancel();
      throw new Error("too large");
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { url: url.toString(), contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), body };
  }
}
