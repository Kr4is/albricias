/**
 * Local media upload helper — Node port of `save_media_file`
 * (`app/helpers.py:24-64`). Writes into `web/public/uploads/<type>s/`, which
 * Next serves from the site root (see `mediaUrl` in `@/lib/media` for the
 * legacy `/static/uploads/...` rewrite Phase 4 added for migrated rows).
 *
 * Deviation from the Python original: images are always re-encoded to JPEG
 * *and* always renamed to a `.jpg` extension. Python only renamed the
 * extension for RGBA/palette sources; an already-RGB source kept its
 * original extension while still being overwritten with JPEG bytes — an
 * upstream inconsistency not worth reproducing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");
const MAX_IMAGE_WIDTH = 1200;
const JPEG_QUALITY = 80;

export type MediaType = "image" | "audio";

/** Same slug rules as `app/helpers.py:slugify`. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `f"{edition.year}-{edition.month:02d}"`, generalised from the old
 * month/year model to the month the edition's period starts in — works for
 * both monthly and weekly editions and keeps filenames human-readable.
 */
export function editionMediaPrefix(edition: { periodStart: Date }): string {
  const year = edition.periodStart.getUTCFullYear();
  const month = String(edition.periodStart.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Save an uploaded image or audio file under `public/uploads/<type>s/` and
 * return its web-accessible path (`/uploads/<type>s/<name>`), or `null` when
 * no file was provided.
 */
export async function saveMediaFile(
  file: File | null | undefined,
  mediaType: MediaType,
  editionPrefix: string,
): Promise<string | null> {
  if (!file || !file.name || file.size === 0) return null;

  const ext = path.extname(file.name);
  const base = path.basename(file.name, ext);
  const originalName = `${editionPrefix}-${slugify(base)}${ext}`;
  const folder = path.join(UPLOAD_ROOT, `${mediaType}s`);
  await mkdir(folder, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());

  if (mediaType === "image") {
    const jpgName = `${path.basename(originalName, ext)}.jpg`;
    try {
      let image = sharp(buffer);
      const metadata = await image.metadata();
      if (metadata.width && metadata.width > MAX_IMAGE_WIDTH) {
        image = image.resize({ width: MAX_IMAGE_WIDTH });
      }
      await image
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(path.join(folder, jpgName));
      return `/uploads/${mediaType}s/${jpgName}`;
    } catch {
      // Not a format sharp can decode (or a corrupt upload) — save it as-is,
      // matching the Python original's fallback to a raw file write.
      await writeFile(path.join(folder, originalName), buffer);
      return `/uploads/${mediaType}s/${originalName}`;
    }
  }

  await writeFile(path.join(folder, originalName), buffer);
  return `/uploads/${mediaType}s/${originalName}`;
}
