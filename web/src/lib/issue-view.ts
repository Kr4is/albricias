/**
 * Mappers from a generated issue's plain data to the view shapes the
 * newspaper components render, resolving the computed period labels
 * (`dateLabel`, `dateShortLabel`, `weather`).
 */

import {
  editionWeather,
  periodLabel,
  periodLabelShort,
} from "@/lib/edition-helpers";
import type { EditionHeaderInfo } from "@/components/Header";
import type { IssueArticle, IssueView } from "@/components/issue/types";

/** The fields these mappers read from a generated (never-persisted) issue. */
export interface EditionRow {
  id: number;
  cadence: string;
  periodStart: Date;
  periodEnd: Date;
  title: string;
  status: string;
  vol: string;
  coverImage: string | null;
  layoutVariant?: number | null;
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
 * Where an article headline in an issue layout should point. Generated
 * issues are ephemeral and never get their own route, so headlines are
 * inert — the anchor is just what makes them look and behave like a
 * newspaper headline.
 */
export function articleHref(): string {
  return "#";
}
