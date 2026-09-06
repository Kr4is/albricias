/**
 * Per-article text-to-speech — turns an `Article`'s own `content` into an
 * audio rendition attached via the existing `Article.audio` field, using
 * OpenAI's TTS endpoint (`openai` package, already a dependency for Whisper
 * transcription in `@/lib/sources/audio.ts`).
 *
 * This is not a whole-edition podcast: it's a single article's narration,
 * triggered on demand from the article edit screen (see the sibling
 * `generate-audio` route next to `.../regenerate/route.ts`).
 *
 * Saved files reuse the exact upload convention from `@/lib/media-upload.ts`
 * (`saveMediaFile`) so the resulting `/uploads/audios/<name>` path is played
 * back by the same `<audio>` element the article edit page and public site
 * already use for manually-uploaded audio (`mediaUrl(article.audio)`).
 */

import OpenAI from "openai";

import { saveMediaFile, editionMediaPrefix } from "@/lib/media-upload";
import { prisma } from "@/lib/prisma";

/** Same family of small, cheap models used elsewhere (`WHISPER_MODEL` sibling). */
export const TTS_MODEL = "tts-1";

/** A steady, authoritative voice, fitting the newspaper's narrating persona. */
export const TTS_VOICE = "onyx";

/**
 * OpenAI's TTS endpoint caps `input` at 4096 characters. Long articles are
 * truncated to this budget rather than chunked/concatenated — good enough for
 * a single newspaper piece; revisit if articles regularly run longer.
 */
const TTS_INPUT_MAX = 4096;

function requireOpenAiKey(apiKey?: string): string {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  return key;
}

/**
 * Strip common Markdown formatting down to plain narration text.
 *
 * `@/lib/markdown.ts` only renders Markdown to HTML (for the web page), it
 * has no plain-text extraction path — this is a small, purpose-built
 * stripper rather than a second markdown-to-html pass plus HTML stripping.
 */
export function stripMarkdownForNarration(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2") // bold+italic
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/^\s*([-*_]\s*){3,}$/gm, "") // horizontal rules
    .replace(/^\s*[-*+]\s+/gm, "") // bullet list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/\n{3,}/g, "\n\n") // collapse extra blank lines
    .trim();
}

/**
 * Generate a TTS audio rendition of `Article.content` and attach it via
 * `Article.audio`, following the same public-path convention manually
 * uploaded audio already uses.
 *
 * Throws (does not flash/catch itself) when the article doesn't exist or
 * when no OpenAI API key is available — the caller (the `generate-audio`
 * route) is responsible for the non-fatal, flash-messaged handling, matching
 * `regenerateArticle`'s contract.
 */
export async function generateArticleAudio(
  articleId: number,
  apiKey?: string,
): Promise<void> {
  const key = requireOpenAiKey(apiKey);

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { edition: true },
  });
  if (!article) {
    throw new Error(`Article ${articleId} not found.`);
  }

  const narrationText = [article.title, stripMarkdownForNarration(article.content)]
    .filter(Boolean)
    .join(".\n\n")
    .slice(0, TTS_INPUT_MAX);

  const client = new OpenAI({ apiKey: key });
  const response = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: narrationText,
    response_format: "mp3",
  });
  const buffer = Buffer.from(await response.arrayBuffer());

  // `saveMediaFile` slugifies the basename itself, so the raw article title
  // is a fine `File.name` here — no need to slugify twice.
  const editionPrefix = editionMediaPrefix(article.edition);
  const audioFile = new File([buffer], `${article.title || "article"}-audio.mp3`, {
    type: "audio/mpeg",
  });

  const publicPath = await saveMediaFile(audioFile, "audio", editionPrefix);
  if (!publicPath) {
    throw new Error("Failed to save generated audio file.");
  }

  await prisma.article.update({
    where: { id: articleId },
    data: { audio: publicPath },
  });
}
