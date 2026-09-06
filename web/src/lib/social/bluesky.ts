/**
 * Bluesky (AT Protocol) posting client, via the official `@atproto/api`
 * package. No OAuth dance — Bluesky's simplest auth for a single personal
 * account is an identifier (handle or DID) + an app password generated from
 * the account's own Settings > App Passwords screen, exactly what the admin
 * form at `/admin/social` collects and stores in
 * `SocialAccount.credentials` (service: "bluesky") as
 * `{ identifier, appPassword }`.
 *
 * Uses the deprecated-but-still-supported `AtpAgent` convenience class
 * (`@atproto/api`'s own docs recommend `Agent` + `CredentialSession` for new
 * code, but that split exists to support persisted multi-request sessions —
 * this module logs in fresh for each post, an infrequent admin-triggered
 * action, so the simpler single-class API is a better fit and avoids an
 * extra layer for no benefit here).
 */

import { AtpAgent } from "@atproto/api";
import { getSocialAccount, parseCredentials } from "./store";

/** Bluesky's documented post length limit (graphemes, not bytes — treated as chars here). */
export const BLUESKY_TEXT_LIMIT = 300;

const BLUESKY_SERVICE_URL = "https://bsky.social";

interface BlueskyCredentials {
  identifier: string;
  appPassword: string;
}

/**
 * Post `text` to Bluesky on behalf of the connected account. Returns the new
 * post's public `bsky.app` URL.
 *
 * Throws when Bluesky isn't connected/enabled, login fails (bad app
 * password), or the post itself fails — callers flash the error.
 */
export async function postToBluesky(text: string): Promise<{ url: string }> {
  const account = await getSocialAccount("bluesky");
  if (!account || !account.enabled) {
    throw new Error("Bluesky is not connected. Connect it from /admin/social first.");
  }
  const { identifier, appPassword } = parseCredentials<BlueskyCredentials>(account);

  const agent = new AtpAgent({ service: BLUESKY_SERVICE_URL });
  await agent.login({ identifier, password: appPassword });

  const { uri } = await agent.post({ text, createdAt: new Date().toISOString() });

  // uri shape: at://<did>/app.bsky.feed.post/<rkey>
  const match = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/.exec(uri);
  const did = match?.[1] ?? agent.session?.did ?? identifier;
  const rkey = match?.[2] ?? "";
  return { url: `https://bsky.app/profile/${did}/post/${rkey}` };
}
