/**
 * Media URL helpers for the public site.
 *
 * Flask served uploads from `/static/uploads/<type>s/<name>` (see
 * `save_media_file` in `app/helpers.py:24-64`) and those absolute paths are
 * stored verbatim in the `articles.image`/`audio` and `editions.cover_image`
 * columns. Next.js serves `web/public/` from the site root instead, so rows
 * carried over by the Phase 5 migration point at a path that no longer exists.
 *
 * `mediaUrl` rewrites that one legacy prefix and leaves everything else — new
 * `/uploads/...` paths and absolute `http(s)` URLs — untouched.
 */

const LEGACY_PREFIX = "/static/uploads/";
const UPLOADS_PREFIX = "/uploads/";

export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith(LEGACY_PREFIX)) {
    return UPLOADS_PREFIX + path.slice(LEGACY_PREFIX.length);
  }
  return path;
}
