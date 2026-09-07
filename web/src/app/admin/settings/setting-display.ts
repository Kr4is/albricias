/**
 * Read-only helper for `/admin/settings`'s forms: resolves the same
 * DB-then-default precedence `getSetting()` uses (`@/lib/config/settings.ts`),
 * but returns *where the effective value came from* instead of the value
 * itself, so the page can show "using saved setting" / "not configured"
 * without ever needing to decrypt a secret for display.
 *
 * For a `secret` field, `value` is always `""` — the caller renders a masked
 * placeholder and a "leave blank to keep the current value" input instead of
 * round-tripping a decrypted secret into the page's HTML. For a non-secret
 * field, `value` is the actual current effective value (safe to show and
 * pre-fill, since it was stored unencrypted on purpose).
 */

import { prisma } from "@/lib/prisma";

export type SettingSource = "db" | "none";

export interface SettingDisplayInfo {
  /** `""` for a `secret` field, regardless of source. */
  value: string;
  source: SettingSource;
  /** True when a DB row was found (not just a default). */
  configured: boolean;
}

export interface SettingDisplayOptions {
  /** When true, `value` is never populated — only source/configured are meaningful. */
  secret?: boolean;
  default?: string;
}

export async function settingDisplay(
  key: string,
  opts: SettingDisplayOptions = {},
): Promise<SettingDisplayInfo> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) {
    return { value: opts.secret ? "" : row.value, source: "db", configured: true };
  }

  return { value: opts.default ?? "", source: "none", configured: false };
}

/** Human-readable badge text for a {@link SettingDisplayInfo}. */
export function sourceLabel(info: SettingDisplayInfo, hasDefault: boolean): string {
  if (info.source === "db") return "Using saved setting";
  return hasDefault ? "Not configured — using built-in default" : "Not configured";
}
