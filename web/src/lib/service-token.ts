/**
 * `ServiceToken` persistence helpers — get / upsert / isExpired — ported from
 * `app/models/service_token.py:14-74`. Flagged in the Phase 2 notes as
 * planned but never built; the Spotify OAuth routes need them.
 *
 * One row per service (`service = "spotify"` today), updated in place on
 * every token refresh so the app always has a valid access token available.
 */

import { prisma } from "@/lib/prisma";
import type { ServiceToken } from "@/generated/prisma/client";

/** Same 60-second buffer as `ServiceToken.is_expired` in the Python original. */
const EXPIRY_BUFFER_MS = 60_000;

/** Convenience lookup by service name — ported from `ServiceToken.get`. */
export async function getServiceToken(service: string): Promise<ServiceToken | null> {
  return prisma.serviceToken.findUnique({ where: { service } });
}

/** `True` if the access token has expired (with a 60-second buffer). */
export function isServiceTokenExpired(token: Pick<ServiceToken, "expiresAt">): boolean {
  if (!token.expiresAt) return false;
  return Date.now() >= token.expiresAt.getTime() - EXPIRY_BUFFER_MS;
}

export interface UpsertServiceTokenOptions {
  service: string;
  accessToken: string;
  /** Only updated when provided — Spotify may not rotate the refresh token. */
  refreshToken?: string | null;
  /** Seconds until `accessToken` expires. */
  expiresIn?: number | null;
  /** Only updated when provided. */
  scope?: string | null;
}

/**
 * Create or update the token record for `service` — ported from
 * `ServiceToken.upsert`. `expiresAt` is always (re)computed from `expiresIn`,
 * including being reset to `null` when omitted, matching the Python original.
 */
export async function upsertServiceToken({
  service,
  accessToken,
  refreshToken,
  expiresIn,
  scope,
}: UpsertServiceTokenOptions): Promise<ServiceToken> {
  const expiresAt = expiresIn != null ? new Date(Date.now() + expiresIn * 1000) : null;
  const existing = await getServiceToken(service);

  if (!existing) {
    return prisma.serviceToken.create({
      data: {
        service,
        accessToken,
        refreshToken: refreshToken ?? null,
        expiresAt,
        scope: scope ?? null,
      },
    });
  }

  return prisma.serviceToken.update({
    where: { service },
    data: {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      expiresAt,
      ...(scope ? { scope } : {}),
    },
  });
}
