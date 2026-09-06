/* eslint-disable @next/next/no-page-custom-font -- the rule targets the Pages
   Router's `_document`; in the App Router these links live in the root layout
   and are therefore shared by every page, which is what the rule asks for. */
/**
 * Root document shell, ported from `app/templates/base.html`.
 *
 * Everything inside `<body>` that base.html owned — the `max-w-[1400px]`
 * broadsheet wrapper, the header partial and `<main>` — lives in
 * `<NewspaperShell>` instead, because each page needs to feed the header its
 * own issue/article context (Jinja did that through globals).
 *
 * Tailwind arrives through the real PostCSS build rather than base.html's Play
 * CDN `<script>`; `tailwind.config.ts` reproduces the CDN's inline config
 * exactly. The Google Fonts and Material Icons links are kept verbatim so the
 * type renders identically.
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "¡Albricias!",
  icons: {
    icon: [{ url: "/images/favicon.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400&family=Libre+Franklin:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons|Material+Symbols+Outlined"
          rel="stylesheet"
        />
      </head>
      <body className="text-ink antialiased min-h-screen flex flex-col fade-in">
        {children}
      </body>
    </html>
  );
}
