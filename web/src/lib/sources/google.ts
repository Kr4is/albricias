/**
 * Google OAuth 2.0 + Calendar/Docs API integration — Phase F of the
 * google-calendar-alexandria-sources plan.
 *
 * Mirrors `./spotify.ts`'s shape (auth URL generation, code exchange, token
 * refresh) for Google's OAuth 2.0 flow. Endpoints and scope strings verified
 * against Google's current developer docs (2026) rather than assumed:
 *   - Authorization endpoint: https://accounts.google.com/o/oauth2/v2/auth
 *   - Token endpoint:         https://oauth2.googleapis.com/token
 *   - Scopes:                 calendar.readonly, documents.readonly
 * Unlike Spotify (which authenticates the token request with a Basic-auth
 * header), Google's token endpoint takes `client_id`/`client_secret` as plain
 * form fields — both the code exchange and the refresh call use the same
 * `postToken` helper.
 *
 * `access_type=offline` + `prompt=consent` are always sent on the authorize
 * URL: Google only issues a refresh token on a user's *first* consent unless
 * `prompt=consent` forces the consent screen (and a fresh refresh token) on
 * every connect — appropriate here since this is a rarely-used, single-admin
 * "connect once" flow, matching the plan's OAuth "Testing" mode setup.
 *
 * Credentials are resolved exclusively via `getSetting()`
 * (`@/lib/config/settings.ts`) from values entered at `/admin/settings` —
 * client ID, client secret, and redirect URI (e.g.
 * http://localhost:3000/admin/calendar/callback) — no env-var fallback.
 *
 * `getValidGoogleAccessToken()` is a small orchestration helper — unlike
 * Spotify (one call site for its refresh-if-expired dance, kept inline in
 * `runEditionGeneration`), Google's access token is needed from at least
 * three independent call sites (the calendar stats ranking, the
 * `calendar_event` source processor, and the admin UI's calendar list/event
 * browser), so the "get the stored token, refresh it if expired, persist the
 * refresh" dance is centralised here once instead of copy-pasted three times.
 */

import { getSetting } from "@/lib/config/settings";
import { getServiceToken, isServiceTokenExpired, upsertServiceToken } from "@/lib/service-token";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_DOCS_API_URL = "https://docs.googleapis.com/v1/documents";
const DEFAULT_REDIRECT_URI = "http://localhost:3000/admin/calendar/callback";

/**
 * Read-only Calendar (list + fetch events) and read-only Docs (fetch Gemini
 * meeting notes) — the minimum scopes this integration needs.
 */
export const GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/documents.readonly";

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

async function requireSetting(key: string, encrypted: boolean, label: string): Promise<string> {
  const value = await getSetting(key, { encrypted });
  if (!value) throw new Error(`${label} is not configured. Set it at /admin/settings.`);
  return value;
}

function clientId(): Promise<string> {
  return requireSetting("integrations.google.clientId", false, "Google client ID");
}

function clientSecret(): Promise<string> {
  return requireSetting("integrations.google.clientSecret", true, "Google client secret");
}

function redirectUri(): Promise<string> {
  return getSetting("integrations.google.redirectUri", {
    default: DEFAULT_REDIRECT_URI,
  }) as Promise<string>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The token response Google returns from both grant types. */
export interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds until `access_token` expires. */
  expires_in: number;
  /** Only present on the very first consent, or every time when `prompt=consent` is sent. */
  refresh_token?: string;
  scope?: string;
}

/**
 * Build the Google `/o/oauth2/v2/auth` redirect URL.
 *
 * `access_type=offline` + `prompt=consent` guarantee a refresh token is
 * (re)issued on every connect — see the module doc comment.
 */
export async function getGoogleAuthUrl(state = ""): Promise<string> {
  const [id, redirect] = await Promise.all([clientId(), redirectUri()]);
  const params = new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: redirect,
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  if (state) params.set("state", state);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const [id, secret] = await Promise.all([clientId(), clientSecret()]);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      ...body,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as GoogleTokenResponse;
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  return postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: await redirectUri(),
  });
}

/**
 * Obtain a fresh access token from a stored refresh token. Google never
 * rotates the refresh token on this grant type, so the response's
 * `refresh_token` field is normally absent — callers should keep using the
 * one they already stored.
 */
export function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/**
 * Return a currently-valid Google access token, transparently refreshing (and
 * persisting the refresh) when the stored one has expired. Returns `null`
 * when Google Calendar has never been connected — never throws for that case,
 * so callers can treat "not connected" as a normal, skippable state.
 */
export async function getValidGoogleAccessToken(): Promise<string | null> {
  let token = await getServiceToken("google");
  if (!token) return null;

  if (isServiceTokenExpired(token) && token.refreshToken) {
    const refreshed = await refreshGoogleAccessToken(token.refreshToken);
    await upsertServiceToken({
      service: "google",
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresIn: refreshed.expires_in,
    });
    token = await getServiceToken("google");
  }

  return token?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function getJson<T>(
  url: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(query ? `${url}?${query}` : url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google API request failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Calendar API — calendar listing
// ---------------------------------------------------------------------------

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
}

interface RawCalendarListEntry {
  id?: string;
  summary?: string;
  primary?: boolean;
}

/**
 * List every calendar in the connected account. `GET /users/me/calendarList`.
 * Entries without an `id` or `summary` (shouldn't happen, but the API's
 * fields are technically optional) are skipped.
 */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const data = await getJson<{ items?: RawCalendarListEntry[] }>(
    `${GOOGLE_CALENDAR_API_URL}/users/me/calendarList`,
    accessToken,
    { maxResults: "250" },
  );
  const entries: GoogleCalendarListEntry[] = [];
  for (const item of data.items ?? []) {
    if (!item.id) continue;
    entries.push({ id: item.id, summary: item.summary ?? item.id, primary: item.primary });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Calendar API — full event fetch (Articles/Both calendars only)
// ---------------------------------------------------------------------------

export interface GoogleCalendarEventTime {
  /** Set for all-day events (`YYYY-MM-DD`); mutually exclusive with `dateTime`. */
  date?: string;
  /** Set for timed events (RFC3339). */
  dateTime?: string;
}

export interface GoogleCalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

export interface GoogleCalendarAttachment {
  fileUrl?: string;
  fileId?: string;
  mimeType?: string;
  title?: string;
}

/**
 * A full Calendar event — title, description, attendees, attachments.
 * Only ever fetched for Articles/Both calendars; never used on the Stats
 * path (see {@link fetchCalendarEventStats}, whose minimal return type
 * structurally excludes all of these fields).
 */
export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: GoogleCalendarEventTime;
  end?: GoogleCalendarEventTime;
  attendees?: GoogleCalendarAttendee[];
  attachments?: GoogleCalendarAttachment[];
}

/** Parse a Calendar API event-time object into a `Date`, handling both all-day and timed events. */
export function parseGoogleEventTime(time: GoogleCalendarEventTime | undefined): Date | null {
  if (!time) return null;
  const raw = time.dateTime ?? time.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface FetchCalendarEventsOptions {
  maxResults?: number;
}

/**
 * Fetch full events for one calendar in `[periodStart, periodEnd)`.
 * `GET /calendars/{calendarId}/events`, `singleEvents=true` so recurring
 * events are expanded to individual instances, ordered soonest-first.
 *
 * Only call this for a calendar in "articles" or "both" mode — it returns
 * title/description/attendees/attachments, which must never be fetched for a
 * Stats-only calendar.
 */
export async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  periodStart: Date,
  periodEnd: Date,
  options: FetchCalendarEventsOptions = {},
): Promise<GoogleCalendarEvent[]> {
  const data = await getJson<{ items?: GoogleCalendarEvent[] }>(
    `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    {
      timeMin: periodStart.toISOString(),
      timeMax: periodEnd.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(options.maxResults ?? 250),
    },
  );
  return data.items ?? [];
}

/** Fetch one full event by ID. `GET /calendars/{calendarId}/events/{eventId}`. */
export async function getCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<GoogleCalendarEvent> {
  return getJson<GoogleCalendarEvent>(
    `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Calendar API — minimal stats fetch (Stats-only + Both calendars)
// ---------------------------------------------------------------------------

/**
 * One event's timing only — no id, title, description, attendees, or
 * attachments. This is the *only* shape the calendar stats ranking
 * (`@/lib/rankings/calendar.ts`) ever sees, and it is structurally incapable
 * of carrying event content: the type itself has no field to put it in.
 */
export interface CalendarEventTiming {
  start: Date;
  end: Date;
}

interface RawEventTiming {
  start?: GoogleCalendarEventTime;
  end?: GoogleCalendarEventTime;
}

/**
 * Fetch only start/end timestamps for one calendar's events in
 * `[periodStart, periodEnd)` — for the privacy-sensitive stats ranking path.
 *
 * The `fields` query parameter restricts the Calendar API's *response itself*
 * to `items(start,end)`: title, description, attendees and attachments are
 * never transmitted over the wire for a Stats-only calendar, not merely
 * dropped after the fact. Combined with this function's return type (which
 * has no field to hold them), a future refactor cannot accidentally leak a
 * Stats-only calendar's event content into this path — there is nowhere for
 * it to go.
 */
export async function fetchCalendarEventStats(
  accessToken: string,
  calendarId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<CalendarEventTiming[]> {
  const data = await getJson<{ items?: RawEventTiming[] }>(
    `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    {
      timeMin: periodStart.toISOString(),
      timeMax: periodEnd.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      fields: "items(start,end)",
    },
  );
  const timings: CalendarEventTiming[] = [];
  for (const item of data.items ?? []) {
    const start = parseGoogleEventTime(item.start);
    const end = parseGoogleEventTime(item.end);
    if (start && end) timings.push({ start, end });
  }
  return timings;
}

// ---------------------------------------------------------------------------
// Docs API — Gemini meeting notes text extraction
// ---------------------------------------------------------------------------

interface DocsTextRun {
  content?: string;
}

interface DocsParagraphElement {
  textRun?: DocsTextRun;
}

interface DocsParagraph {
  elements?: DocsParagraphElement[];
}

interface DocsTableCell {
  content?: DocsStructuralElement[];
}

interface DocsTableRow {
  tableCells?: DocsTableCell[];
}

interface DocsTable {
  tableRows?: DocsTableRow[];
}

interface DocsStructuralElement {
  paragraph?: DocsParagraph;
  table?: DocsTable;
}

interface DocsDocument {
  body?: { content?: DocsStructuralElement[] };
}

/** Walk a Docs API structural-element tree, concatenating every `textRun`'s content (paragraphs and table cells). */
function extractDocsText(content: DocsStructuralElement[] | undefined): string {
  let text = "";
  for (const element of content ?? []) {
    if (element.paragraph) {
      for (const paragraphElement of element.paragraph.elements ?? []) {
        text += paragraphElement.textRun?.content ?? "";
      }
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          text += extractDocsText(cell.content);
        }
      }
    }
  }
  return text;
}

/**
 * Fetch a Google Doc's plain text via `documents.get`, walking
 * `body.content`'s structural elements (paragraphs and table cells) per the
 * Docs API's documented `Document` resource shape.
 */
export async function getGoogleDocText(accessToken: string, documentId: string): Promise<string> {
  const doc = await getJson<DocsDocument>(
    `${GOOGLE_DOCS_API_URL}/${encodeURIComponent(documentId)}`,
    accessToken,
  );
  return extractDocsText(doc.body?.content).trim();
}

export { describe as describeGoogleError };
