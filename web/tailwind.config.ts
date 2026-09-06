/**
 * Ported verbatim from the inline `tailwind.config` in
 * `app/templates/base.html:20-43` (the Flask app loads Tailwind from the Play
 * CDN with `?plugins=forms,typography,container-queries`).
 *
 * Tailwind v3 is pinned deliberately: the Play CDN serves v3, and v4 changes
 * enough preflight/utility defaults (default border colour, `space-*`
 * selectors, ring width) to break the pixel parity this phase is about.
 */

import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";
import typography from "@tailwindcss/typography";
import containerQueries from "@tailwindcss/container-queries";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: "#f4f1ea",
        ink: "#1a1a1a",
        "ink-light": "#4a4a4a",
      },
      fontFamily: {
        masthead: ['"UnifrakturMaguntia"', "cursive"],
        headline: ['"Playfair Display"', "serif"],
        body: ['"Merriweather"', "serif"],
        sans: ['"Libre Franklin"', "sans-serif"],
        display: ['"Newsreader"', "serif"],
      },
      screens: {
        print: { raw: "print" },
      },
    },
  },
  plugins: [forms, typography, containerQueries],
};

export default config;
