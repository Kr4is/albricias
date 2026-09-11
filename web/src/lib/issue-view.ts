/**
 * Mappers from Prisma rows to the plain view shapes the newspaper components
 * render, resolving the computed properties the Flask models exposed
 * (`Edition.date`, `.date_short`, `.weather`).
 *
 * Keeping this in one place means the public pages, the 404 shell and the
 * Phase 3 admin preview all derive the same labels from the same helpers.
 */

import {
  editionWeather,
  periodLabel,
  periodLabelShort,
} from "@/lib/edition-helpers";
import type { EditionHeaderInfo } from "@/components/Header";
import type {
  IssueArticle,
  IssueNavRef,
  IssueView,
} from "@/components/issue/types";

/** The Edition columns these mappers read. */
export interface EditionRow {
  id: number;
  cadence: string;
  periodStart: Date;
  periodEnd: Date;
  title: string;
  status: string;
  vol: string;
  coverImage: string | null;
}

/** The Article columns the layouts read. */
export interface ArticleRow {
  id: number;
  title: string;
  content: string;
  category: string;
  author: string | null;
  deck: string;
}

export function toIssueView(edition: EditionRow): IssueView {
  return {
    id: edition.id,
    title: edition.title,
    status: edition.status,
    vol: edition.vol,
    coverImage: edition.coverImage,
    dateLabel: periodLabel(edition),
    dateShortLabel: periodLabelShort(edition),
    weather: editionWeather(edition),
  };
}

export function toIssueNavRef(edition: EditionRow): IssueNavRef {
  return { id: edition.id, dateShortLabel: periodLabelShort(edition) };
}

export function toEditionHeaderInfo(edition: EditionRow): EditionHeaderInfo {
  return {
    vol: edition.vol,
    dateLabel: periodLabel(edition),
    weather: editionWeather(edition),
  };
}

export function toIssueArticle(article: ArticleRow): IssueArticle {
  return {
    id: article.id,
    title: article.title,
    content: article.content,
    category: article.category,
    author: article.author,
    deck: article.deck,
  };
}

/**
 * Where an article link in an issue layout should point. The public
 * `/article/[id]` route 404s for unpublished editions (see `isPublished` in
 * `edition-helpers.ts`), so admin preview links — where the edition may still
 * be a draft — go to the `/admin/*`-gated article preview route instead.
 */
export function articleHref(editionId: number, articleId: number, isPreview: boolean): string {
  return isPreview
    ? `/admin/editions/${editionId}/articles/${articleId}/preview`
    : `/article/${articleId}`;
}
