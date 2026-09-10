/**
 * The client-safe half of `./setting-display.ts`: just the shape of a
 * resolved setting and the pure function that turns it into label text.
 * Split out so `./fields.tsx`'s `StatusNote` (and anything that imports it,
 * including the `"use client"` `./ai-provider-fields.tsx`) never pulls in
 * `settingDisplay()`'s `@/lib/prisma` import — that chain ends in
 * `better-sqlite3`'s native bindings, which don't exist in a browser bundle.
 */

export type SettingSource = "db" | "none";

export interface SettingDisplayInfo {
  /** `""` for a `secret` field, regardless of source. */
  value: string;
  source: SettingSource;
  /** True when a DB row was found (not just a default). */
  configured: boolean;
}

/** Human-readable badge text for a {@link SettingDisplayInfo}. */
export function sourceLabel(info: SettingDisplayInfo, hasDefault: boolean): string {
  if (info.source === "db") return "Using saved setting";
  return hasDefault ? "Not configured — using built-in default" : "Not configured";
}
