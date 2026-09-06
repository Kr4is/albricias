/**
 * `<input type="date">` helpers shared by the admin forms (article dates,
 * the compose form, the API's `date` field). Mirrors Python's
 * `datetime.date.fromisoformat` / `.isoformat()` closely enough for these
 * purposes: a bare `YYYY-MM-DD`, interpreted as a UTC calendar date.
 */

/** Format a Date as an `<input type="date">` value (`YYYY-MM-DD`, UTC date part). */
export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse an `<input type="date">` value into a UTC-midnight Date, or `null` if invalid/empty. */
export function parseDateInputValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}
