/**
 * DB-backed admin password storage — the only source of truth for the admin
 * credential. See `.omc/plans/settings-single-path-onboarding.md`: there is
 * no `process.env.ADMIN_PASSWORD` fallback of any kind. An unconfigured
 * instance (no DB hash) is only ever reachable through `/setup`, which is
 * the sole way to create the admin password.
 *
 * The password itself is never stored — only a salted `scrypt` hash
 * (`node:crypto`'s built-in, no new dependency), further encrypted at rest
 * via `src/lib/config/crypto.ts` before being written to the `Setting`
 * table under the key `"auth.adminPasswordHash"`.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getSetting, setSetting } from "@/lib/config/settings";

const ADMIN_PASSWORD_HASH_KEY = "auth.adminPasswordHash";
const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `"<salt-base64>:<hash-base64>"`. */
function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

function verifyAgainstHash(password: string, combined: string): boolean {
  const [saltB64, hashB64] = combined.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, salt, expected.length);
  return safeEqual(actual, expected);
}

/**
 * True once a DB-stored admin password hash exists. This is the exact gate
 * `proxy.ts` (and `/login`) use to decide between `/setup` and `/login`.
 */
export async function hasAdminPassword(): Promise<boolean> {
  const stored = await getSetting(ADMIN_PASSWORD_HASH_KEY, { encrypted: true });
  return Boolean(stored);
}

/** Hash and store `password` as the new DB admin credential. */
export async function setAdminPassword(password: string): Promise<void> {
  await setSetting(ADMIN_PASSWORD_HASH_KEY, hashPassword(password), { encrypted: true });
}

/**
 * Verify a submitted password against the DB-stored hash. This should never
 * actually be called with no DB hash present once `/login` correctly gates
 * on `hasAdminPassword()` first — but defensively, with nothing to compare
 * against, this rejects rather than silently accepting anything.
 */
export async function verifyStoredAdminPassword(password: string): Promise<boolean> {
  const stored = await getSetting(ADMIN_PASSWORD_HASH_KEY, { encrypted: true });
  if (!stored) return false;
  return verifyAgainstHash(password, stored);
}
