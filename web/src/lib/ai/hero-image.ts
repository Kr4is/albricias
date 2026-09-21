/**
 * AI-generated imagery for the newspaper — always a last resort, never the
 * first choice:
 *   - {@link generateHeroImage}: one article's hero, only once its source
 *     turned up no real, attributable image (see `SourceResult.imageUrl` in
 *     `@/lib/sources/types` and its one producer, `@/lib/sources/github-repo`).
 *   - {@link generateEditionCoverImage}: the edition's own front-page cover —
 *     there is no "real" source for an entire month at once, so this is the
 *     only source for `Edition.coverImage`, called once per edition after
 *     its articles are written (`populateEditionDraft`), themed on their
 *     titles rather than any single one.
 * Both are optional by design — a missing OpenAI key, a failed request, or a
 * malformed response all just mean "no image," the same graceful
 * degradation every other enrichment in the generation pipeline uses.
 *
 * Uses OpenAI's images endpoint directly via `fetch` rather than through
 * `@/lib/ai/provider`'s Mastra/Vercel-AI-SDK model resolution — that
 * abstraction exists for text generation and doesn't wrap image generation,
 * so this reuses only the one setting it also reads
 * (`integrations.openai.apiKey`). Requests `dall-e-3` with
 * `response_format: "b64_json"` deliberately: the alternative, a hosted
 * `url`, expires after about an hour — worthless once written into the DB
 * for permanent display. `gpt-image-1` was considered and rejected for the
 * same reason organization-verification requirements make it unreliable to
 * depend on here: this needs to work with just an API key.
 */

import { getSetting } from "@/lib/config/settings";
import { saveMediaFile } from "@/lib/media-upload";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const REQUEST_TIMEOUT_MS = 60_000;

/** A shared closing line: the one thing every generated image must avoid, regardless of subject. */
const STYLE_DIRECTION =
  "Style: vintage newspaper engraving / halftone print illustration, monochrome or sepia-toned, " +
  "high contrast, no text or lettering anywhere in the image.";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ImageSize = "1024x1024" | "1792x1024" | "1024x1792";

/** Request one image from OpenAI and save it locally, or `null` if that isn't possible right now. */
async function requestAndSaveImage(
  prompt: string,
  size: ImageSize,
  editionPrefix: string,
  filenameSuffix: string,
): Promise<string | null> {
  const apiKey = await getSetting("integrations.openai.apiKey", { encrypted: true });
  if (!apiKey) return null;

  try {
    const response = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        quality: "standard",
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[hero-image] OpenAI image generation failed: HTTP ${response.status} — ${await response.text()}`);
      return null;
    }
    const body = (await response.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) return null;

    const buffer = Buffer.from(b64, "base64");
    const file = new File([buffer], `${editionPrefix}-${filenameSuffix}.png`, { type: "image/png" });
    return await saveMediaFile(file, "image", editionPrefix);
  } catch (error) {
    console.error(`[hero-image] Generation failed: ${describe(error)}`);
    return null;
  }
}

export interface GenerateHeroImageOptions {
  title: string;
  subject: string;
  editionPrefix: string;
}

/** Generate and locally save one article's hero image, or `null` if that isn't possible right now. */
export async function generateHeroImage({
  title,
  subject,
  editionPrefix,
}: GenerateHeroImageOptions): Promise<string | null> {
  const about = subject.trim() || title;
  const prompt = `Editorial illustration for a newspaper feature titled "${title}", about ${about}. ${STYLE_DIRECTION}`;
  return requestAndSaveImage(prompt, "1024x1024", editionPrefix, "hero");
}

export interface GenerateEditionCoverImageOptions {
  editionTitle: string;
  /** A handful of this edition's article titles — enough to theme the piece, not a full table of contents. */
  articleTitles: string[];
  editionPrefix: string;
}

/**
 * Generate and locally save this edition's front-page cover image, themed on
 * a handful of its own article titles rather than any one of them — a
 * single composition standing in for "what this month was", the way a real
 * masthead engraving or an anniversary-issue frontispiece would. Landscape
 * (`1792x1024`), unlike the square per-article hero: this renders as a
 * full-width banner near the masthead, not a figure inside one column.
 */
export async function generateEditionCoverImage({
  editionTitle,
  articleTitles,
  editionPrefix,
}: GenerateEditionCoverImageOptions): Promise<string | null> {
  const themes = articleTitles.slice(0, 6).join("; ");
  const prompt = [
    `Editorial cover illustration for a newspaper's monthly issue titled "${editionTitle}", drawn loosely from this`,
    `month's stories: ${themes}.`,
    "A single unified composition rather than a collage of separate scenes — evoke the month's throughline, not each headline literally.",
    STYLE_DIRECTION,
  ].join(" ");
  return requestAndSaveImage(prompt, "1792x1024", editionPrefix, "cover");
}
