/**
 * Generalized settings store, backed by the `Setting` Prisma model. This is
 * the one place every credential/setting is read from: a DB-stored value
 * wins when present, else a documented default. There is deliberately no
 * `process.env` fallback here — per
 * `.omc/plans/settings-single-path-onboarding.md`, every credential is
 * configured exclusively through the web interface (`/setup`,
 * `/admin/settings`), and `.env` carries nothing but `DATABASE_URL`.
 *
 * Deliberately generic and feature-agnostic: this file knows nothing about
 * admin passwords, OpenAI keys, or SMTP — it only knows how to get/set a
 * named string value, optionally encrypted via `src/lib/config/crypto.ts`.
 */

import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/config/crypto";

export interface GetSettingOptions {
  /**
   * Whether this setting is expected to be stored encrypted. Documented for
   * callers' clarity; the actual decrypt decision always uses the row's own
   * `encrypted` column (the source of truth of what was actually written),
   * not this flag.
   */
  encrypted?: boolean;
  /** Used when no DB row exists for `key`. */
  default?: string;
}

export interface SetSettingOptions {
  /** Encrypt `value` via `src/lib/config/crypto.ts` before storing it. */
  encrypted?: boolean;
}

/**
 * Resolve a setting's value: DB row (decrypted if `row.encrypted`) first,
 * else `opts.default`, else `undefined`.
 */
export async function getSetting(
  key: string,
  opts: GetSettingOptions = {},
): Promise<string | undefined> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) {
    return row.encrypted ? decrypt(row.value) : row.value;
  }
  return opts.default;
}

/**
 * Upsert `key` = `value` into the `Setting` table, encrypting first when
 * `opts.encrypted` is true (and recording that on the row's `encrypted`
 * column, so `getSetting` knows to decrypt it back).
 */
export async function setSetting(
  key: string,
  value: string,
  opts: SetSettingOptions = {},
): Promise<void> {
  const encrypted = opts.encrypted ?? false;
  const storedValue = encrypted ? encrypt(value) : value;
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: storedValue, encrypted },
    update: { value: storedValue, encrypted },
  });
}
