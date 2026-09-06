/**
 * Archive — paginated browse of published editions or their articles.
 * Ported from `public.archive` (`app/routes/public.py:89-154`) and
 * `app/templates/archive.html`.
 *
 * Deviations from the Jinja original, both forced:
 *  - the articles grid printed `article.issue.date_short`, but Article's
 *    backref is `edition`, not `issue`, so Jinja raised `UndefinedError` and
 *    that view 500'd. Rendered from `article.edition` here, which is plainly
 *    what was meant.
 *  - `public.py` also queried a `categories` list and passed it to the
 *    template, which never referenced it. Dropped.
 *
 * The year list is derived in JS from `periodStart` rather than a `SELECT
 * DISTINCT year`: the period model has no year column, and an archive is
 * dozens of rows, not thousands.
 */

import { Fragment } from "react";
import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import { prisma } from "@/lib/prisma";
import { ARTICLE_ORDER, yearRange } from "@/lib/editions";
import { EDITION_STATUS_PUBLISHED, periodLabel, periodLabelShort } from "@/lib/edition-helpers";
import { mediaUrl } from "@/lib/media";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Archive - Albricias" };

const PER_PAGE = 8;
const ALL_YEARS = "All Years";

type ViewMode = "issues" | "articles";

/** `url_for('public.archive', ...)`: omit params the Jinja call passed as None. */
function archiveHref(options: {
  year?: string;
  view?: ViewMode;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (options.year && options.year !== ALL_YEARS) params.set("year", options.year);
  if (options.view) params.set("view", options.view);
  if (options.page !== undefined) params.set("page", String(options.page));
  const query = params.toString();
  return query ? `/archive?${query}` : "/archive";
}

/** `request.args.get(name)` — Flask keeps the first value of a repeated key. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** `request.args.get("page", 1, type=int)` — anything unparseable falls back to 1. */
function parsePage(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? 1 : value;
}

export default async function ArchivePage({
  searchParams,
}: PageProps<"/archive">) {
  const query = await searchParams;
  const selectedYear = firstValue(query.year) ?? ALL_YEARS;
  const viewMode: ViewMode =
    firstValue(query.view) === "articles" ? "articles" : "issues";
  const page = parsePage(firstValue(query.page));

  // Distinct published years, newest first.
  const publishedPeriods = await prisma.edition.findMany({
    where: { status: EDITION_STATUS_PUBLISHED },
    select: { periodStart: true },
    orderBy: { periodStart: "desc" },
  });
  const years = [
    ALL_YEARS,
    ...Array.from(
      new Set(publishedPeriods.map((e) => String(e.periodStart.getUTCFullYear()))),
    ),
  ];

  // `try: int(selected_year) except ValueError: pass` — an unparseable year
  // simply leaves the filter off.
  const parsedYear = Number.parseInt(selectedYear, 10);
  const yearFilter =
    selectedYear !== ALL_YEARS && !Number.isNaN(parsedYear)
      ? { periodStart: yearRange(parsedYear) }
      : {};

  const skip = Math.max(0, (page - 1) * PER_PAGE);

  const articleItems: ArticleItem[] = [];
  const issueItems: IssueItem[] = [];
  let total: number;

  if (viewMode === "articles") {
    const where = {
      edition: { status: EDITION_STATUS_PUBLISHED, ...yearFilter },
    };
    const [rows, count] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: [{ edition: { periodStart: "desc" } }, ...ARTICLE_ORDER],
        skip,
        take: PER_PAGE,
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          author: true,
          deck: true,
          edition: { select: { cadence: true, periodStart: true, periodEnd: true } },
        },
      }),
      prisma.article.count({ where }),
    ]);
    total = count;
    articleItems.push(
      ...rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        category: row.category,
        author: row.author,
        deck: row.deck,
        editionDateShort: periodLabelShort(row.edition),
      })),
    );
  } else {
    const where = { status: EDITION_STATUS_PUBLISHED, ...yearFilter };
    const [rows, count] = await Promise.all([
      prisma.edition.findMany({
        where,
        orderBy: { periodStart: "desc" },
        skip,
        take: PER_PAGE,
        select: {
          id: true,
          cadence: true,
          periodStart: true,
          periodEnd: true,
          vol: true,
          coverImage: true,
          _count: { select: { articles: true } },
          articles: {
            orderBy: [...ARTICLE_ORDER],
            take: 1,
            select: { deck: true, content: true },
          },
        },
      }),
      prisma.edition.count({ where }),
    ]);
    total = count;
    issueItems.push(
      ...rows.map((row) => ({
        id: row.id,
        dateLabel: periodLabel(row),
        dateShortLabel: periodLabelShort(row),
        vol: row.vol,
        coverImage: row.coverImage,
        articleCount: row._count.articles,
        leadArticle: row.articles[0] ?? null,
      })),
    );
  }

  const itemCount = viewMode === "articles" ? articleItems.length : issueItems.length;
  const pages = total === 0 ? 0 : Math.ceil(total / PER_PAGE);
  const hasPrev = page > 1;
  const hasNext = page < pages;

  return (
    <NewspaperShell endpoint="public.archive">
      <div className="pb-12">
        {/* View Toggle Tabs */}
        <div className="flex items-center justify-center gap-4 mb-8 border-b border-ink pb-4">
          <a
            href={archiveHref({ view: "issues", year: selectedYear })}
            className={`px-6 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
              viewMode === "issues"
                ? "bg-ink text-white"
                : "text-ink hover:bg-stone-100 border border-ink"
            }`}
          >
            <span className="material-icons text-sm align-middle mr-1">
              collections_bookmark
            </span>
            Browse Issues
          </a>
          <a
            href={archiveHref({ view: "articles", year: selectedYear })}
            className={`px-6 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
              viewMode === "articles"
                ? "bg-ink text-white"
                : "text-ink hover:bg-stone-100 border border-ink"
            }`}
          >
            <span className="material-icons text-sm align-middle mr-1">article</span>
            Browse Articles
          </a>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 border-b border-stone-300 pb-4 mb-8">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide w-full sm:w-auto">
            <span className="mr-3 text-sm font-bold font-serif text-ink uppercase tracking-wide whitespace-nowrap">
              Select Year:
            </span>
            {years.map((year, index) => (
              <Fragment key={year}>
                {index !== 0 && <span className="text-stone-300 mx-2">|</span>}
                <a
                  href={archiveHref({ year, view: viewMode, page: 1 })}
                  className={`text-lg transition-colors ${
                    year === selectedYear
                      ? "font-bold border-b-2 border-ink"
                      : "font-normal text-stone-500 hover:text-ink"
                  }`}
                >
                  {year}
                </a>
              </Fragment>
            ))}
          </div>

          <div className="text-sm text-stone-600 font-sans">
            Showing {itemCount} of {total}{" "}
            {viewMode === "articles" ? "articles" : "issues"}
            {selectedYear !== ALL_YEARS && ` from ${selectedYear}`}
          </div>
        </div>

        {viewMode === "articles" ? (
          /* Articles Grid */
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
            {articleItems.map((article) => (
              <article
                key={article.id}
                className="group border border-stone-200 p-6 hover:border-ink transition-colors bg-white"
              >
                <div className="flex items-start gap-4">
                  <span className="font-masthead text-4xl text-ink leading-none">
                    {article.deck}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500 bg-stone-100 px-2 py-0.5">
                        {article.category}
                      </span>
                      <span className="text-[10px] text-stone-400">
                        {article.editionDateShort}
                      </span>
                    </div>
                    <a href={`/article/${article.id}`}>
                      <h3 className="font-headline text-xl font-bold leading-tight mb-2 group-hover:underline">
                        {article.title}
                      </h3>
                    </a>
                    <p className="text-sm font-body text-stone-600 line-clamp-2 mb-3">
                      {article.content.slice(0, 150)}...
                    </p>
                    <div className="flex items-center justify-between">
                      {article.author && (
                        <span className="text-[10px] font-sans uppercase text-stone-500">
                          By {article.author}
                        </span>
                      )}
                      <a
                        href={`/article/${article.id}`}
                        className="text-xs font-bold uppercase tracking-widest text-ink hover:underline"
                      >
                        Read →
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          /* Issues Grid */
          <div
            id="issues-container"
            className="grid gap-x-8 gap-y-12 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          >
            {issueItems.map((issue) => (
              <article
                key={issue.id}
                className="group flex flex-col items-start issue-card"
                data-id={issue.id}
              >
                {/* Image Container */}
                <a
                  href={`/edition/${issue.id}`}
                  className="block relative overflow-hidden bg-stone-100 border border-stone-300 transition-all duration-500 group-hover:border-ink w-full mb-5 aspect-[3/4]"
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center grayscale contrast-125 transition-all duration-700 group-hover:scale-105 group-hover:grayscale-0"
                    style={{
                      backgroundImage: `url('${mediaUrl(issue.coverImage) ?? ""}')`,
                    }}
                  ></div>
                  <div className="absolute inset-0 bg-black/10 mix-blend-multiply transition-opacity group-hover:opacity-0"></div>
                  {/* Date Tag */}
                  <div className="absolute top-0 right-0 bg-ink text-white px-3 py-1 font-display font-bold text-xs tracking-wider z-10">
                    {issue.dateShortLabel}
                  </div>
                  {/* Article count badge */}
                  <div className="absolute bottom-0 left-0 bg-white/90 text-ink px-2 py-1 font-sans font-bold text-[10px] uppercase tracking-wider">
                    {issue.articleCount} articles
                  </div>
                </a>

                {/* Content */}
                <div className="flex w-full flex-col gap-3">
                  <div className="flex items-baseline justify-between border-t-2 border-ink pt-2">
                    <a href={`/edition/${issue.id}`}>
                      <h3 className="font-display text-xl font-bold leading-tight text-ink group-hover:underline decoration-2">
                        {issue.dateLabel}
                      </h3>
                    </a>
                  </div>
                  <p className="font-display text-[10px] font-bold uppercase tracking-widest text-stone-500">
                    {issue.vol}
                  </p>

                  {issue.leadArticle && (
                    <p className="line-clamp-3 text-sm font-body leading-relaxed text-stone-800">
                      <span className="float-left mr-1 text-2xl font-bold leading-none font-masthead">
                        {issue.leadArticle.deck}
                      </span>
                      {issue.leadArticle.content.slice(0, 100)}...
                    </p>
                  )}

                  <a
                    href={`/edition/${issue.id}`}
                    className="mt-2 inline-flex items-center text-xs font-bold uppercase tracking-widest text-ink border-b border-ink pb-0.5 hover:bg-ink hover:text-white transition-colors self-start"
                  >
                    Read Edition{" "}
                    <span className="material-icons ml-1 text-[14px]">
                      arrow_forward
                    </span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}

        {itemCount === 0 && (
          <div className="text-center py-12">
            <p className="font-headline text-xl text-stone-500 italic">
              No {viewMode === "articles" ? "articles" : "issues"} found for the
              selected criteria.
            </p>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="mt-16 flex flex-col items-center justify-center border-t border-ink pt-8">
            <div className="flex items-center gap-4">
              {hasPrev ? (
                <a
                  href={archiveHref({
                    year: selectedYear,
                    view: viewMode,
                    page: page - 1,
                  })}
                  className="group flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-widest text-ink hover:bg-stone-100 transition-colors"
                >
                  <span className="material-icons text-sm transition-transform group-hover:-translate-x-1">
                    arrow_back
                  </span>
                  Prev
                </a>
              ) : (
                <span className="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-widest text-stone-300 cursor-not-allowed">
                  <span className="material-icons text-sm">arrow_back</span>
                  Prev
                </span>
              )}

              <div className="flex items-center border border-ink p-1 bg-white">
                {Array.from({ length: pages }, (_, i) => i + 1).map((pageNum) => {
                  if (pageNum === page) {
                    return (
                      <span
                        key={pageNum}
                        className="w-8 h-8 flex items-center justify-center bg-ink text-white text-sm font-bold"
                      >
                        {pageNum}
                      </span>
                    );
                  }
                  if (
                    pageNum === 1 ||
                    pageNum === pages ||
                    (pageNum >= page - 1 && pageNum <= page + 1)
                  ) {
                    return (
                      <a
                        key={pageNum}
                        href={archiveHref({
                          year: selectedYear,
                          view: viewMode,
                          page: pageNum,
                        })}
                        className="w-8 h-8 flex items-center justify-center text-ink hover:bg-stone-200 text-sm font-bold transition-colors"
                      >
                        {pageNum}
                      </a>
                    );
                  }
                  if (pageNum === 2 && page > 3) {
                    return (
                      <span
                        key={pageNum}
                        className="w-8 h-8 flex items-center justify-center text-ink"
                      >
                        ...
                      </span>
                    );
                  }
                  if (pageNum === pages - 1 && page < pages - 2) {
                    return (
                      <span
                        key={pageNum}
                        className="w-8 h-8 flex items-center justify-center text-ink"
                      >
                        ...
                      </span>
                    );
                  }
                  return null;
                })}
              </div>

              {hasNext ? (
                <a
                  href={archiveHref({
                    year: selectedYear,
                    view: viewMode,
                    page: page + 1,
                  })}
                  className="group flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-widest text-ink hover:bg-stone-100 transition-colors"
                >
                  Next
                  <span className="material-icons text-sm transition-transform group-hover:translate-x-1">
                    arrow_forward
                  </span>
                </a>
              ) : (
                <span className="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-widest text-stone-300 cursor-not-allowed">
                  Next
                  <span className="material-icons text-sm">arrow_forward</span>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </NewspaperShell>
  );
}

interface ArticleItem {
  id: number;
  title: string;
  content: string;
  category: string;
  author: string | null;
  deck: string;
  editionDateShort: string;
}

interface IssueItem {
  id: number;
  dateLabel: string;
  dateShortLabel: string;
  vol: string;
  coverImage: string | null;
  articleCount: number;
  leadArticle: { deck: string; content: string } | null;
}
