/**
 * Mastodon posting client — plain REST against a user-configured instance,
 * authenticated with an application access token the admin generates
 * themselves from their own instance's Settings > Development screen (no
 * OAuth redirect dance needed for a single personal account posting to its
 * own instance). The admin form at `/admin/social` collects both the
 * instance URL and the token and stores them in `SocialAccount.credentials`
 * (service: "mastodon") as `{ instanceUrl, accessToken }`.
 */

import { getSocialAccount, parseCredentials } from "./store";

/**
 * Mastodon's *default* server-side post limit. Individual instances can
 * configure a different `max_toot_chars` (exposed via that instance's
 * `/api/v1/instance` endpoint) — 500 is used here as the safe, documented
 * default for the copy-generation length budget; an instance with a larger
 * limit simply gets a shorter-than-necessary post, never a rejected one.
 */
export const MASTODON_TEXT_LIMIT = 500;

interface MastodonCredentials {
  instanceUrl: string;
  accessToken: string;
}

function normalizeInstanceUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Post `text` to the connected Mastodon account's instance. Returns the new
 * status's public URL.
 *
 * Throws when Mastodon isn't connected/enabled or the API call fails —
 * callers flash the error.
 */
export async function postToMastodon(text: string): Promise<{ url: string }> {
  const account = await getSocialAccount("mastodon");
  if (!account || !account.enabled) {
    throw new Error("Mastodon is not connected. Connect it from /admin/social first.");
  }
  const { instanceUrl, accessToken } = parseCredentials<MastodonCredentials>(account);

  const response = await fetch(`${normalizeInstanceUrl(instanceUrl)}/api/v1/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ status: text }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Posting to Mastodon failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as { url: string };
  return { url: json.url };
}
