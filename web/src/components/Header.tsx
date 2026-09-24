/* eslint-disable @next/next/no-html-link-for-pages -- plain <a> tags are
   deliberate: `body.fade-in` and the article stagger in globals.css are
   one-shot CSS animations that only replay on a full document load, which
   next/link's client-side navigation would skip. */
/**
 * The broadsheet masthead, with today's date and the site's two links
 * (the landing page and the generator).
 */

import { newspaperConfig } from "@/lib/newspaper";

export type Endpoint = "home" | "app";

export interface HeaderProps {
  endpoint: Endpoint;
}

const NAV_LINK =
  "underline decoration-2 underline-offset-4 hover:decoration-current transition-colors duration-150 ease-out";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `now.strftime('%A, %B %d, %Y')`, zero-padded day included. */
function longDate(now: Date): string {
  const day = String(now.getDate()).padStart(2, "0");
  return `${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${day}, ${now.getFullYear()}`;
}

export default async function Header({ endpoint }: HeaderProps) {
  const newspaper = await newspaperConfig();
  const now = new Date();

  return (
    <header className="flex flex-col px-6 sm:px-8 lg:px-10 pt-4 print:px-0">
      {/* Top Meta Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 items-center py-2 border-b border-ink border-double text-[10px] sm:text-xs font-sans font-bold uppercase tracking-widest gap-y-2 md:gap-y-0">
        <div className="text-center md:text-left order-2 md:order-1">
          <span>
            VOL. {now.getFullYear()} . NO. {now.getMonth() + 1}
          </span>
        </div>
        <div className="text-center order-1 md:order-2">
          <span>{longDate(now)}</span>
        </div>
        <div className="flex justify-center md:justify-end gap-6 no-print order-3">
          <a
            href="/"
            className={`${NAV_LINK} ${endpoint === "home" ? "decoration-current" : "decoration-transparent"}`}
          >
            Home
          </a>
          <a
            href="/app"
            className={`${NAV_LINK} ${endpoint === "app" ? "decoration-current" : "decoration-transparent"}`}
          >
            Generate Yours
          </a>
        </div>
      </div>

      {/* Masthead */}
      <div className="text-center py-6 sm:py-8 lg:py-10">
        <a href="/" className="inline-block">
          <h1 className="font-masthead text-6xl md:text-8xl lg:text-[7.5rem] leading-none text-ink drop-shadow-sm tracking-tight hover:opacity-90 transition-opacity">
            {newspaper.name}
          </h1>
        </a>
      </div>

      {/* Sub-header Bar */}
      <div className="border-t border-b border-ink py-1.5 mb-1">
        <div className="grid grid-cols-3 items-center text-[9px] sm:text-[10px] font-sans font-bold uppercase tracking-wider">
          <div className="text-left italic font-serif normal-case font-normal text-stone-600">
            &quot;{newspaper.tagline}&quot;
          </div>
          <div className="text-center">
            Late City Edition
          </div>
          <div className="text-right">
            {newspaper.metadataRight}
          </div>
        </div>
      </div>
      <div className="border-b-2 border-ink mb-6"></div>
    </header>
  );
}
