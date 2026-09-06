/**
 * Text / notes source processor — normalizes pasted text or uploaded `.txt`
 * files. No external API calls.
 *
 * Ported 1:1 from `app/services/sources/text.py`.
 */

import type { SourceResult, SourceType } from "./types";

/** The two `SourceType`s this module produces. */
export type TextSourceType = Extract<SourceType, "text" | "notes">;

/** Strip excessive whitespace and normalize line endings. */
function normalize(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Python's `str.split()` — split on runs of any whitespace, dropping empties. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Process a plain-text string (a pasted transcription or a block of notes).
 *
 * `sourceType` is `"text"` for prose/transcription, `"notes"` for bullet points.
 */
export function processText(
  raw: string,
  sourceType: TextSourceType = "text",
): SourceResult {
  const normalized = normalize(raw);
  return {
    text: normalized,
    sourceType,
    metadata: {
      word_count: countWords(normalized),
      char_count: normalized.length,
    },
  };
}

/**
 * Read and process an uploaded plain-text file.
 *
 * Accepts a web `File`/`Blob` (what `formData.get(...)` returns) or raw bytes.
 * Invalid UTF-8 is replaced rather than rejected, matching Python's
 * `decode("utf-8", errors="replace")`.
 */
export async function processTextFile(
  data: File | Blob | Buffer | Uint8Array | ArrayBuffer,
  filename: string,
  sourceType: TextSourceType = "text",
): Promise<SourceResult> {
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const raw = new TextDecoder("utf-8").decode(bytes);
  const result = processText(raw, sourceType);
  result.metadata.filename = filename;
  return result;
}
