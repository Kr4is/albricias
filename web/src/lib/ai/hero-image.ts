/**
 * Last-resort hero image: only called once a generated article's source
 * turned up no real, attributable image (see `SourceResult.imageUrl` in
 * `@/lib/sources/types` and its one producer, `@/lib/sources/github-repo`).
 * Optional by design — a missing OpenAI key, a failed request, or a
 * malformed response all just mean "no hero image," the same graceful
 * degradation every other enrichment in the generation pipeline uses.
 *
 * Uses OpenAI's images endpoint directly via `fetch` rather than through
 * `@/lib/ai/provider`'s Mastra/Vercel-AI-SDK model resolution — that
 * abstraction exists for text generation and doesn't wrap image generation,
 * so this reuses only the one setting it also reads
 * (`integrations.openai.apiKey`). Requests `dall-e-3` with
 * `response_format: "b64_json"` deliberately: the alternative, a hosted
 * `url`, expires after about an hour — worthless once written into
 * `Article.image` for permanent display. `gpt-image-1` was considered and
 * rejected for the same reason organization-verification requirements make
 * it unreliable to depend on here: this needs to work with just an API key.
 */

import { getSetting } from "@/lib/config/settings";
import { saveMediaFile } from "@/lib/media-upload";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const REQUEST_TIMEOUT_MS = 60_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A restrained, consistent art direction — plain full-color AI illustration
 * would clash with the paper/ink vintage-newspaper look the rest of the site
 * already commits to (see `globals.css`'s ported print styling).
 */
function buildPrompt(title: string, subject: string): string {
  const about = subject.trim() || title;
  return [
    `Editorial illustration for a newspaper feature titled "${title}", about ${about}.`,
    "Style: vintage newspaper engraving / halftone print illustration, monochrome or sepia-toned, high contrast, no text or lettering anywhere in the image.",
  ].join(" ");
}

export interface GenerateHeroImageOptions {
  title: string;
  subject: string;
  editionPrefix: string;
}

/** Generate and locally save a hero image, or `null` if that isn't possible right now. */
export async function generateHeroImage({
  title,
  subject,
  editionPrefix,
}: GenerateHeroImageOptions): Promise<string | null> {
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
        prompt: buildPrompt(title, subject),
        n: 1,
        size: "1024x1024",
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
    const file = new File([buffer], `${editionPrefix}-hero.png`, { type: "image/png" });
    return await saveMediaFile(file, "image", editionPrefix);
  } catch (error) {
    console.error(`[hero-image] Generation failed: ${describe(error)}`);
    return null;
  }
}
