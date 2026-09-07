/**
 * Meeting-notes source processor — Phase F of the
 * google-calendar-alexandria-sources plan.
 *
 * Given a specific Google Calendar event, fetches the full event (title,
 * description, attendees, attachments) and looks for a Gemini "Take notes for
 * me" meeting-notes Google Doc attached to it. Per Google's current Meet/Docs
 * behaviour (verified against current docs, not assumed from training data):
 * Gemini generates the notes doc and Google attaches it to the Calendar event
 * via the event's ordinary `attachments` array — a Google Docs file
 * (`mimeType: "application/vnd.google-apps.document"`), not a separate
 * `conferenceData` field. When found, its text is fetched via the Docs API
 * (`documents.get`) and used as the seed text; otherwise this falls back to
 * the event's title + description + attendee names, matching the plan's "no
 * hard requirement" framing for meeting notes.
 *
 * Only ever called for an event on an "articles" or "both" mode calendar —
 * this module always fetches full event content, never the minimal
 * start/end-only shape the Stats path uses (`@/lib/sources/google.ts`'s
 * {@link fetchCalendarEventStats}).
 */

import { getCalendarEvent, getGoogleDocText } from "./google";
import type { GoogleCalendarAttachment, GoogleCalendarEvent } from "./google";
import type { SourceResult } from "./types";

/** The MIME type Google Drive/Docs uses for a native Google Doc. */
const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";

/** Fallback: pull a Docs file ID out of a `docs.google.com/document/d/<id>/...` URL. */
const DOC_URL_ID_PATTERN = /\/document\/d\/([a-zA-Z0-9_-]+)/;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Find the attached meeting-notes Google Doc's file ID, if any. Prefers the
 * attachment's own `fileId` (present for Drive-hosted attachments); falls
 * back to parsing it out of `fileUrl` for the rare case `fileId` is absent.
 */
function findNotesDocId(attachments: GoogleCalendarAttachment[] | undefined): string | null {
  for (const attachment of attachments ?? []) {
    if (attachment.mimeType !== GOOGLE_DOC_MIME_TYPE) continue;
    if (attachment.fileId) return attachment.fileId;
    const match = attachment.fileUrl?.match(DOC_URL_ID_PATTERN);
    if (match) return match[1];
  }
  return null;
}

/** Build the title + description + attendee-names fallback seed text. */
function buildFallbackText(event: GoogleCalendarEvent): string {
  const attendeeNames = (event.attendees ?? [])
    .map((attendee) => attendee.displayName || attendee.email)
    .filter((name): name is string => Boolean(name));

  const parts = [
    event.summary ?? "",
    event.description ?? "",
    attendeeNames.length > 0 ? `Attendees: ${attendeeNames.join(", ")}` : "",
  ].filter(Boolean);

  return parts.join("\n\n").trim();
}

export interface FetchCalendarEventSourceOptions {
  accessToken: string;
  calendarId: string;
  eventId: string;
}

/**
 * Fetch one Calendar event and turn it into a `SourceResult`, ready for the
 * existing assisted-generation pipeline (`source_type: "calendar_event"`).
 *
 * `metadata.notesSource` is `"gemini_notes_doc"` when real meeting notes were
 * found and used, or `"title_description_fallback"` when there were none (or
 * the notes doc failed to fetch) — the admin UI surfaces this so the operator
 * can tell which path was used, per the plan's acceptance criteria.
 */
export async function fetchCalendarEventSource({
  accessToken,
  calendarId,
  eventId,
}: FetchCalendarEventSourceOptions): Promise<SourceResult> {
  const event = await getCalendarEvent(accessToken, calendarId, eventId);
  const notesDocId = findNotesDocId(event.attachments);

  if (notesDocId) {
    try {
      const notesText = await getGoogleDocText(accessToken, notesDocId);
      if (notesText) {
        return {
          text: notesText,
          sourceType: "calendar_event",
          metadata: {
            calendarId,
            eventId,
            eventTitle: event.summary ?? "",
            notesSource: "gemini_notes_doc",
            documentId: notesDocId,
          },
        };
      }
    } catch (error) {
      // Non-fatal — fall through to the title/description/attendees seed
      // text below, same as when no notes doc is attached at all.
      console.error(`[calendar-event] Notes doc fetch failed for ${notesDocId}: ${describe(error)}`);
    }
  }

  return {
    text: buildFallbackText(event),
    sourceType: "calendar_event",
    metadata: {
      calendarId,
      eventId,
      eventTitle: event.summary ?? "",
      notesSource: "title_description_fallback",
    },
  };
}
