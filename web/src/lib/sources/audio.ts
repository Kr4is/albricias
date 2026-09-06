/**
 * Audio source processor — transcribes uploaded audio via OpenAI Whisper.
 *
 * Ported 1:1 from `app/services/sources/audio.py`, including the exact
 * conversation-mode prompt (changing it changes every future transcription).
 *
 * Two modes are supported:
 *   - `monologue`    — single speaker; plain transcription.
 *   - `conversation` — multiple speakers; Whisper is prompted to mark speaker
 *                      turns so the interview generator can build a Q&A.
 */

import OpenAI, { toFile } from "openai";

import type { SourceResult } from "./types";

/** Container/codec combinations Whisper accepts. */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".wav",
  ".webm",
  ".ogg",
  ".flac",
] as const;

export const WHISPER_MODEL = "whisper-1";

/** Verbatim from `audio.py:_CONVERSATION_PROMPT`. */
const CONVERSATION_PROMPT =
  "The following is a conversation or interview between two or more people. " +
  "Please transcribe it clearly, indicating speaker changes with 'Speaker 1:', " +
  "'Speaker 2:', etc. when a new speaker begins talking.";

export type AudioMode = "monologue" | "conversation";

export interface AudioProcessOptions {
  /**
   * The audio bytes. A `File` straight out of `formData.get(...)` works, as do
   * a `Blob`, a `Buffer`, or a `Uint8Array`.
   */
  data: File | Blob | Buffer | Uint8Array | ArrayBuffer;
  /** Original filename — Whisper infers the container from its extension. */
  filename: string;
  mode: AudioMode;
  /** OpenAI API key. */
  apiKey: string;
}

/**
 * Transcribe `data` with OpenAI Whisper.
 *
 * Returns a `SourceResult` whose `sourceType` is `"audio_monologue"` or
 * `"audio_conversation"`, ready to hand to any generator.
 */
export async function processAudio({
  data,
  filename,
  mode,
  apiKey,
}: AudioProcessOptions): Promise<SourceResult> {
  const client = new OpenAI({ apiKey });
  const file = await toFile(data, filename);

  const transcription = await client.audio.transcriptions.create({
    model: WHISPER_MODEL,
    file,
    response_format: "text",
    ...(mode === "conversation" ? { prompt: CONVERSATION_PROMPT } : {}),
  });

  const text = transcription.trim();
  const wordCount = countWords(text);

  return {
    text,
    sourceType: mode === "conversation" ? "audio_conversation" : "audio_monologue",
    metadata: {
      filename,
      mode,
      word_count: wordCount,
      model: WHISPER_MODEL,
    },
  };
}

/** Python's `str.split()` — split on runs of any whitespace, dropping empties. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
