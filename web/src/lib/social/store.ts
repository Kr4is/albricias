/**
 * `SocialAccount` persistence helpers — get / upsert / delete, mirroring
 * `@/lib/service-token.ts`'s pattern for `ServiceToken` (Spotify).
 *
 * See the `SocialAccount` model doc comment in `prisma/schema.prisma` for why
 * this is a separate model rather than a reuse of `ServiceToken`: credentials
 * are a per-service-shaped JSON blob (`credentials` column), parsed with
 * {@link parseCredentials} by each network's own client module.
 */

import { prisma } from "@/lib/prisma";
import type { SocialAccount } from "@/generated/prisma/client";

export type SocialService = "twitter" | "bluesky" | "mastodon";

/** Convenience lookup by service name. */
export async function getSocialAccount(service: SocialService): Promise<SocialAccount | null> {
  return prisma.socialAccount.findUnique({ where: { service } });
}

/** All connected accounts, for admin/review-screen "connected?" checks in bulk. */
export async function listSocialAccounts(): Promise<SocialAccount[]> {
  return prisma.socialAccount.findMany();
}

/** Create or replace the credentials row for `service`. Always enables it. */
export async function upsertSocialAccount(
  service: SocialService,
  credentials: unknown,
): Promise<SocialAccount> {
  const credentialsJson = JSON.stringify(credentials);
  return prisma.socialAccount.upsert({
    where: { service },
    create: { service, credentials: credentialsJson, enabled: true },
    update: { credentials: credentialsJson, enabled: true },
  });
}

/** Removes the row entirely — the "Disconnect" action for every network. */
export async function deleteSocialAccount(service: SocialService): Promise<void> {
  await prisma.socialAccount.deleteMany({ where: { service } });
}

/** Parse a `SocialAccount.credentials` JSON blob into its network-specific shape. */
export function parseCredentials<T>(account: SocialAccount): T {
  return JSON.parse(account.credentials) as T;
}

/**
 * Load a connected + enabled account for `service`, or throw a clear,
 * user-facing error — the shared "not connected" guard every `postTo*`
 * function starts with, so callers get one consistent error message to flash.
 */
export async function requireEnabledAccount(service: SocialService): Promise<SocialAccount> {
  const account = await getSocialAccount(service);
  if (!account || !account.enabled) {
    throw new Error(`${service} is not connected. Connect it from /admin/social first.`);
  }
  return account;
}
