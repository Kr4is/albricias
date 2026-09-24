/** Masthead branding. */

export interface NewspaperConfig {
  name: string;
  tagline: string;
  price: string;
  metadataRight: string;
}

/** Also read directly by client components (the export masthead), which can't await. */
export const NEWSPAPER_CONFIG: NewspaperConfig = {
  name: "¡Albricias!",
  tagline: "All the News That's Fit to Print",
  price: "Two Cents",
  metadataRight: "",
};

export async function newspaperConfig(): Promise<NewspaperConfig> {
  return NEWSPAPER_CONFIG;
}
