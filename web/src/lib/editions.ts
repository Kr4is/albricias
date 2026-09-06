/**
 * Read-only queries behind the public site, ported from `app/routes/public.py`.
 *
 * The Flask queries ordered editions by `(year desc, month desc)`; the period
 * model collapses that into a single `periodStart` ordering, which produces the
 * same sequence for the migrated monthly editions and also does the right thing
 * for weekly ones.
 *
 * Articles are always ordered by `Article.order` — the ordering the
 * `Edition.articles` relationship carried in `app/models/edition.py:37-43` —
 * with `id` as a tie-breaker so equal `order` values are at least stable.
 */

import { prisma } from "@/lib/prisma";
import { EDITION_STATUS_PUBLISHED } from "@/lib/edition-helpers";
import type { ArticleRow, EditionRow } from "@/lib/issue-view";

/** Columns needed to render an edition anywhere on the public site. */
const editionSelect = {
  id: true,
  cadence: true,
  periodStart: true,
  periodEnd: true,
  title: true,
  status: true,
  vol: true,
  coverImage: true,
} as const;

/** Columns needed to render an article inside an issue layout. */
const articleSelect = {
  id: true,
  title: true,
  content: true,
  category: true,
  author: true,
  deck: true,
} as const;

export const ARTICLE_ORDER = [
  { order: "asc" },
  { id: "asc" },
] as const satisfies ReadonlyArray<Record<string, "asc" | "desc">>;

/** Latest published edition — `public.py:50-54`. */
export async function latestPublishedEdition(): Promise<EditionRow | null> {
  return prisma.edition.findFirst({
    where: { status: EDITION_STATUS_PUBLISHED },
    orderBy: { periodStart: "desc" },
    select: editionSelect,
  });
}

/** Newest published edition strictly before `periodStart` — `public.py:58-70`. */
export async function previousPublishedEdition(
  periodStart: Date,
): Promise<EditionRow | null> {
  return prisma.edition.findFirst({
    where: { status: EDITION_STATUS_PUBLISHED, periodStart: { lt: periodStart } },
    orderBy: { periodStart: "desc" },
    select: editionSelect,
  });
}

/** Oldest published edition strictly after `periodStart` — `public.py:181-193`. */
export async function nextPublishedEdition(
  periodStart: Date,
): Promise<EditionRow | null> {
  return prisma.edition.findFirst({
    where: { status: EDITION_STATUS_PUBLISHED, periodStart: { gt: periodStart } },
    orderBy: { periodStart: "asc" },
    select: editionSelect,
  });
}

/**
 * Newest edition of any status strictly before `periodStart`. Used by the
 * admin preview route, which — unlike the public site — shows prev/next
 * across drafts and published editions alike (`admin.py:285-296`).
 */
export async function previousEdition(periodStart: Date): Promise<EditionRow | null> {
  return prisma.edition.findFirst({
    where: { periodStart: { lt: periodStart } },
    orderBy: { periodStart: "desc" },
    select: editionSelect,
  });
}

/** Oldest edition of any status strictly after `periodStart` — see {@link previousEdition}. */
export async function nextEdition(periodStart: Date): Promise<EditionRow | null> {
  return prisma.edition.findFirst({
    where: { periodStart: { gt: periodStart } },
    orderBy: { periodStart: "asc" },
    select: editionSelect,
  });
}

/** One edition by id, published or not — the caller checks `status`. */
export async function editionById(id: number): Promise<EditionRow | null> {
  return prisma.edition.findUnique({ where: { id }, select: editionSelect });
}

/** Every article of an edition, in publication order. */
export async function editionArticles(editionId: number): Promise<ArticleRow[]> {
  return prisma.article.findMany({
    where: { editionId },
    orderBy: [...ARTICLE_ORDER],
    select: articleSelect,
  });
}

/** Half-open UTC range covering a calendar year, for the archive year filter. */
export function yearRange(year: number): { gte: Date; lt: Date } {
  return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
}
