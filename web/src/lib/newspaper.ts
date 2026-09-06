/**
 * Masthead configuration, ported from the Flask context processor
 * `inject_newspaper_config` (`app/extensions.py:18-30`), including its
 * defaults. Read per-request so a container restart is not needed to pick up
 * an env change.
 */

export interface NewspaperConfig {
  name: string;
  tagline: string;
  price: string;
  metadataRight: string;
}

export function newspaperConfig(): NewspaperConfig {
  return {
    name: process.env.NEWSPAPER_NAME || "¡Albricias!",
    tagline: process.env.NEWSPAPER_TAGLINE || "All the News That's Fit to Print",
    price: process.env.NEWSPAPER_PRICE || "Two Cents",
    metadataRight: process.env.NEWSPAPER_METADATA_RIGHT || "",
  };
}
