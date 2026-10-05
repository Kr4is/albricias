/**
 * Umami page-view tracking, when the operator configures it: both
 * `UMAMI_SCRIPT_URL` (the script of their Umami instance, e.g.
 * `https://umami.example.com/script.js`) and `UMAMI_WEBSITE_ID`. Neither set,
 * nothing loads. Read per request (the root layout is dynamic), so the
 * prebuilt Docker image takes them from its environment. Umami sets no
 * cookies; the script is told to honour the browser's Do Not Track.
 */

import Script from "next/script";

function scriptUrl(): string | null {
  const raw = process.env.UMAMI_SCRIPT_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    console.warn("[analytics] UMAMI_SCRIPT_URL is not a valid URL — tracking is off");
    return null;
  }
}

export default function Analytics() {
  const src = scriptUrl();
  const websiteId = process.env.UMAMI_WEBSITE_ID?.trim();
  if (!src || !websiteId) return null;
  const domains = process.env.UMAMI_DOMAINS?.trim();
  return <Script defer src={src} data-website-id={websiteId} data-do-not-track="true" {...(domains ? { "data-domains": domains } : {})} />;
}
