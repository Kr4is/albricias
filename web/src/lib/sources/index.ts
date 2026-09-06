/**
 * Activity sources and assisted-generation input processors.
 *
 * Barrel for `web/src/lib/sources/*` — the admin routes import everything they
 * need from here.
 */

export {
  type ActivityItem,
  type ActivitySource,
  type Period,
  type SourceResult,
  type SourceType,
  SOURCES,
  beforePeriod,
  inPeriod,
  parseTimestamp,
} from "./types";

export { type GithubFetchOptions, fetchGithubActivity } from "./github";
export { type BlogFetchOptions, fetchBlogActivity } from "./blog";
export {
  type SpotifyFetchOptions,
  type SpotifyTokenResponse,
  SPOTIFY_SCOPES,
  exchangeCode,
  fetchSpotifyActivity,
  getAuthUrl,
  refreshAccessToken,
} from "./spotify";
export {
  type AudioMode,
  type AudioProcessOptions,
  SUPPORTED_AUDIO_EXTENSIONS,
  WHISPER_MODEL,
  processAudio,
} from "./audio";
export { type TextSourceType, processText, processTextFile } from "./text";
