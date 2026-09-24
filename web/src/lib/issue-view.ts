/**
 * Where an article headline in an issue layout should point. Generated
 * issues are ephemeral and never get their own route, so headlines are
 * inert — the anchor is just what makes them look and behave like a
 * newspaper headline.
 */
export function articleHref(): string {
  return "#";
}
