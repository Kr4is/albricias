/**
 * Blog RSS activity source — new in the rewrite (Phase 1 of the source plan;
 * there is no Flask equivalent).
 *
 * Fetches an RSS/Atom feed and returns the entries published inside the
 * edition's period, shaped exactly like the GitHub and Spotify sources so the
 * chronicle workflow can group them without special-casing.
 */

import Parser from "rss-parser";

import {
  type ActivityItem,
  type Period,
  inPeriod,
  parseTimestamp,
} from "./types";

/** Same 200-char title budget the GitHub source uses. */
const TITLE_MAX = 200;

export interface BlogFetchOptions extends Period {
  /** Feed URL (`BLOG_RSS_URL`). */
  feedUrl: string;
}

/**
 * Fetch blog posts published inside `[periodStart, periodEnd)`.
 *
 * Entries with no parseable publication date are skipped — without a date there
 * is no way to tell which edition they belong to.
 *
 * Throws if the feed itself cannot be fetched or parsed; callers wrap this the
 * same way `admin.py` wraps the GitHub fetch (non-fatal warning).
 */
export async function fetchBlogActivity({
  feedUrl,
  periodStart,
  periodEnd,
}: BlogFetchOptions): Promise<ActivityItem[]> {
  const period: Period = { periodStart, periodEnd };
  const parser = new Parser();
  const feed = await parser.parseURL(feedUrl);

  const activities: ActivityItem[] = [];
  for (const item of feed.items ?? []) {
    const timestamp = parseTimestamp(item.isoDate ?? item.pubDate);
    if (!inPeriod(timestamp, period)) continue;

    activities.push({
      source: "blog",
      eventType: "blog_post",
      repo: null,
      title: (item.title || "Untitled post").slice(0, TITLE_MAX),
      url: item.link ?? null,
      timestamp,
      raw: item,
    });
  }

  return activities;
}
