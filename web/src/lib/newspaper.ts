/** Masthead branding — fixed, since there's no per-instance admin config anymore. */

export interface NewspaperConfig {
  name: string;
  tagline: string;
  price: string;
  metadataRight: string;
}

const NEWSPAPER_CONFIG: NewspaperConfig = {
  name: "¡Albricias!",
  tagline: "All the News That's Fit to Print",
  price: "Two Cents",
  metadataRight: "",
};

export async function newspaperConfig(): Promise<NewspaperConfig> {
  return NEWSPAPER_CONFIG;
}
