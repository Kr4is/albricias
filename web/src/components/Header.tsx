/* eslint-disable @next/next/no-html-link-for-pages -- see NAVIGATION NOTE below */
/**
 * Ported from `app/templates/partials/header.html`.
 *
 * NAVIGATION NOTE — every link on the public site is a plain `<a>`, not
 * `next/link`. Flask served full page loads, and the vintage look depends on
 * that: `body.fade-in` and the `article:nth-child()` stagger in style.css are
 * one-shot CSS animations that only replay on a document load. Client-side
 * navigation would silently drop the paper's "printing" entrance on every
 * link, which is exactly the kind of drift this port exists to avoid.
 *
 * Jinja read `issue`, `article`, `now`, `session` and `newspaper` off the
 * template globals; here they arrive as props (or, for the session flag, from
 * the request cookie).
 *
 * PARITY NOTE — the original compares `request.endpoint` against bare names
 * (`'archive'`, `'article_detail'`, `'edition_detail'`, `'home'`) while Flask
 * actually reports blueprint-qualified names (`'public.archive'`, …), so those
 * branches never fire on the live site: public pages always show today's date
 * and "Late City Edition", and no nav link is ever underlined. Passing the real
 * endpoint names keeps that rendered output byte-identical. Fixing the
 * comparison lists below is all it would take to switch the intended
 * behaviour on — deliberately left off, since this phase ports rather than
 * redesigns.
 */

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { newspaperConfig } from "@/lib/newspaper";

/** Header-facing view of an Edition — the three fields the masthead reads. */
export interface EditionHeaderInfo {
  vol: string;
  /** `periodLabel(edition)` — the Flask `Edition.date` property. */
  dateLabel: string;
  /** `editionWeather(edition)` — the Flask `Edition.weather` property. */
  weather: string;
}

/** Flask endpoint name of the page being rendered. */
export type Endpoint =
  | "public.home"
  | "public.archive"
  | "public.edition_detail"
  | "public.article_detail"
  | "public.login"
  | "public.page_not_found"
  | "public.newsletter_subscribe"
  | `admin.${string}`;

export interface HeaderProps {
  endpoint: Endpoint;
  issue?: EditionHeaderInfo | null;
  article?: { edition: EditionHeaderInfo } | null;
}

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

/** Python's `now.strftime('%A, %B %d, %Y')`, zero-padded day included. */
function longDate(now: Date): string {
  const day = String(now.getDate()).padStart(2, "0");
  return `${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${day}, ${now.getFullYear()}`;
}

export default async function Header({ endpoint, issue, article }: HeaderProps) {
  const newspaper = newspaperConfig();
  const now = new Date();

  const cookieStore = await cookies();
  const loggedIn = verifySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );

  // Widened to `string` on purpose: the comparison lists below are the ones the
  // Jinja template uses, and they do not overlap the (correct, blueprint-
  // qualified) endpoint names — see the PARITY NOTE at the top of this file.
  const ep: string = endpoint;
  const isArchiveish = ["archive", "article_detail"].includes(ep);
  const isEditionDetail = ep === "edition_detail";
  const isAdmin = ep.startsWith("admin");

  const headerEdition = issue ?? article?.edition ?? null;

  return (
    <header className="flex flex-col px-6 sm:px-8 lg:px-10 pt-4 print:px-0">
      {/* Top Meta Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 items-center py-2 border-b border-ink border-double text-[10px] sm:text-xs font-sans font-bold uppercase tracking-widest gap-y-2 md:gap-y-0">
        <div className="text-center md:text-left order-2 md:order-1">
          {headerEdition ? (
            <span>{headerEdition.vol}</span>
          ) : (
            <span>
              VOL. {now.getFullYear()} . NO. {now.getMonth() + 1}
            </span>
          )}
        </div>
        <div className="text-center order-1 md:order-2">
          {isArchiveish ? (
            <span>Past Editions Archive</span>
          ) : isEditionDetail ? (
            <span>{issue ? issue.dateLabel : "Edition"}</span>
          ) : isAdmin ? (
            <span>Editorial Office</span>
          ) : (
            <span>{longDate(now)}</span>
          )}
        </div>
        <div className="flex justify-center md:justify-end gap-6 no-print order-3">
          <a
            href="/"
            className={`hover:underline decoration-2 underline-offset-4 ${ep === "home" ? "underline" : ""}`}
          >
            Current Edition
          </a>
          <a
            href="/archive"
            className={`hover:underline decoration-2 underline-offset-4 ${
              ["archive", "edition_detail", "article_detail"].includes(ep)
                ? "underline"
                : ""
            }`}
          >
            Archive
          </a>
          {loggedIn && (
            <>
              <a
                href="/admin/editions"
                className={`hover:underline decoration-2 underline-offset-4 ${isAdmin ? "underline" : ""}`}
              >
                Admin
              </a>
              <a
                href="/logout"
                className="hover:underline decoration-2 underline-offset-4 text-red-800"
              >
                Logout
              </a>
            </>
          )}
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
            {isArchiveish
              ? "Browse Collection"
              : isEditionDetail
                ? "Monthly Edition"
                : isAdmin
                  ? "Editorial Office"
                  : "Late City Edition"}
          </div>
          <div className="text-right">
            {headerEdition ? headerEdition.weather : newspaper.metadataRight}
          </div>
        </div>
      </div>
      <div className="border-b-2 border-ink mb-6"></div>
    </header>
  );
}
