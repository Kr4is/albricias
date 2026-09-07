/**
 * Masthead configuration, ported from the Flask context processor
 * `inject_newspaper_config` (`app/extensions.py:18-30`), including its
 * defaults. Read per-request (via `getSetting()`, `@/lib/config/settings.ts`)
 * so no restart is needed to pick up a value saved at `/admin/settings` — a
 * DB-stored value wins, falling back to the defaults below (no env var of
 * any kind).
 */

import { getSetting } from "@/lib/config/settings";

export interface NewspaperConfig {
  name: string;
  tagline: string;
  price: string;
  metadataRight: string;
}

export async function newspaperConfig(): Promise<NewspaperConfig> {
  const [name, tagline, price, metadataRight] = await Promise.all([
    getSetting("branding.newspaperName", { default: "¡Albricias!" }),
    getSetting("branding.tagline", {
      default: "All the News That's Fit to Print",
    }),
    getSetting("branding.price", { default: "Two Cents" }),
    getSetting("branding.metadataRight", { default: "" }),
  ]);
  return {
    name: name || "¡Albricias!",
    tagline: tagline || "All the News That's Fit to Print",
    price: price || "Two Cents",
    metadataRight: metadataRight || "",
  };
}
