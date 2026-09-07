/**
 * Alexandria (personal reading library) activity source.
 *
 * Alexandria is a separate local Flask app
 * (`/Users/bruno/Documents/dev/alexandria`) exposing a small public, read-only
 * JSON endpoint documented in
 * `.omc/notepads/google-calendar-alexandria-sources/alexandria-api.md`:
 *
 *   GET {ALEXANDRIA_API_URL}/api/reading-activity?since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 * `since` is inclusive, `until` is exclusive, applied to `Book.date_finished`
 * — exactly the half-open `[periodStart, periodEnd)` convention `Period`
 * already uses, so the edition's period maps straight onto the query params
 * with no reinterpretation.
 *
 * Two event types are emitted:
 *   - `book_finished` — one item per book in the response's `books_finished`
 *     list (finished inside the period), timestamped by `date_finished`.
 *   - `book_reading`  — one item per book in `currently_reading`. That list
 *     is a point-in-time snapshot (every book with `status === "reading"`),
 *     *not* period-filtered by the API itself — the same "always current,
 *     never date-filtered" shape as Spotify's top-tracks/top-artists items
 *     (`spotify.ts`), so it is carried over here with no timestamp, matching
 *     that convention rather than inventing a new one.
 *
 * Every field the newspaper prompt might want (author, page count, personal
 * rating, personal notes) is folded into `title`, because the chronicle
 * workflow's `summariseGroup` only ever reads `eventType`/`repo`/`title`/
 * `timestamp`/`url` off an `ActivityItem` — `raw` is stored for
 * re-processing but never reaches the prompt.
 *
 * Like `blog.ts`, this module makes a single external call and throws on
 * failure (network error, non-2xx) — the caller (`runEditionGeneration`)
 * wraps it in the same per-source try/catch + non-fatal flash-warning
 * pattern already used for GitHub/blog/Spotify, and skips it gracefully
 * (info-level, not a warning) when the Alexandria API URL isn't configured.
 *
 * Configured exclusively at `/admin/settings` (`integrations.alexandria.*`
 * settings, resolved via `getSetting()` by this module's caller — this file
 * itself takes `apiUrl`/`apiToken` as plain parameters, no env var reads):
 *   apiUrl    e.g. http://localhost:5000 or https://alexandria.brunocabado.com
 *   apiToken  optional — sent as `Authorization: Bearer <token>` when set,
 *             matching Alexandria's optional `READING_API_TOKEN`
 *             bearer-token gate (open when unset on Alexandria's side too).
 */

import { type ActivityItem, type Period, parseTimestamp } from "./types";

/** Same 300-char title budget the Spotify source uses (notes can run long). */
const TITLE_MAX = 300;

export interface AlexandriaFetchOptions extends Period {
  /** Base URL of the Alexandria instance, no trailing slash required. */
  apiUrl: string;
  /** Optional bearer token — sent only when set. */
  apiToken?: string;
}

/** `Book.to_dict()` shape, verbatim per the documented API contract. */
interface AlexandriaBook {
  id: number;
  title: string;
  authors: string;
  thumbnail: string | null;
  description: string | null;
  page_count: number | null;
  categories: string | null;
  published_year: string | null;
  language: string | null;
  average_rating: number | null;
  status: string;
  date_added: string | null;
  date_finished: string | null;
  personal_rating: number | null;
  personal_notes: string | null;
}

interface ReadingActivityResponse {
  period: { since: string | null; until: string | null };
  books_finished: AlexandriaBook[];
  currently_reading: AlexandriaBook[];
  stats: Record<string, unknown>;
}

/** `YYYY-MM-DD` in UTC — the form the `since`/`until` query params expect. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Pack every reader-relevant field into one string for the chronicle prompt. */
function finishedTitle(book: AlexandriaBook): string {
  let title = `${book.title} by ${book.authors}`;
  if (book.page_count) title += `, ${book.page_count}p`;
  if (book.personal_rating != null) title += `, rated ${book.personal_rating}/5`;
  if (book.personal_notes) title += ` — "${book.personal_notes}"`;
  return title.slice(0, TITLE_MAX);
}

function readingTitle(book: AlexandriaBook): string {
  let title = `${book.title} by ${book.authors}`;
  if (book.page_count) title += `, ${book.page_count}p`;
  return title.slice(0, TITLE_MAX);
}

/**
 * Fetch Alexandria reading activity for `[periodStart, periodEnd)` as
 * normalised activity items.
 *
 * Throws on network failure, a non-2xx response, or `ALEXANDRIA_API_URL`
 * being malformed — never for "no data", which the endpoint reports as an
 * ordinary 200 with empty arrays (see the API contract notepad's "Empty /
 * no-data behaviour" section).
 */
export async function fetchAlexandriaActivity({
  apiUrl,
  apiToken,
  periodStart,
  periodEnd,
}: AlexandriaFetchOptions): Promise<ActivityItem[]> {
  const params = new URLSearchParams({
    since: isoDate(periodStart),
    until: isoDate(periodEnd),
  });
  const headers: Record<string, string> = {};
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

  const base = apiUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/reading-activity?${params}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `Alexandria request failed: ${response.status} ${await response.text()}`,
    );
  }
  const data = (await response.json()) as ReadingActivityResponse;

  const activities: ActivityItem[] = [];

  for (const book of data.books_finished ?? []) {
    activities.push({
      source: "alexandria",
      eventType: "book_finished",
      repo: null,
      title: finishedTitle(book),
      url: book.thumbnail ?? null,
      timestamp: parseTimestamp(book.date_finished),
      raw: book,
    });
  }

  for (const book of data.currently_reading ?? []) {
    activities.push({
      source: "alexandria",
      eventType: "book_reading",
      repo: null,
      title: readingTitle(book),
      url: book.thumbnail ?? null,
      timestamp: null,
      raw: book,
    });
  }

  return activities;
}
