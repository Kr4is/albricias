/**
 * Mirrors `/admin/spotify/callback`'s shape: stays under `/admin/*` so
 * `proxy.ts`'s session-cookie guard still applies — the browser making this
 * request is the admin's own, redirected here by Google.
 *
 * After a successful token exchange, immediately syncs the calendar list
 * (`listCalendars` + upsert `CalendarSource` rows, every new calendar
 * defaulting to `"off"` per the model's privacy default) so the admin can
 * start setting per-calendar modes right away without a separate manual
 * "Sync" step. A sync failure is reported as a warning, not an error — the
 * connection itself still succeeded, and the admin can retry via the
 * "Sync calendars" button on `/admin/calendar`.
 */

import type { NextRequest } from "next/server";
import { exchangeGoogleCode, listCalendars } from "@/lib/sources";
import { upsertServiceToken } from "@/lib/service-token";
import { prisma } from "@/lib/prisma";
import { describeError, flashRedirect } from "@/lib/flash";

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: `Google authorization denied: ${error}` },
    ]);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: "Google callback received no authorization code." },
    ]);
  }

  let accessToken: string;
  try {
    const tokenData = await exchangeGoogleCode(code);
    await upsertServiceToken({
      service: "google",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
    });
    accessToken = tokenData.access_token;
  } catch (err) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: `Google token exchange failed: ${describeError(err)}` },
    ]);
  }

  try {
    const calendars = await listCalendars(accessToken);
    await Promise.all(
      calendars.map((calendar) =>
        prisma.calendarSource.upsert({
          where: { googleCalendarId: calendar.id },
          create: { googleCalendarId: calendar.id, name: calendar.summary },
          update: { name: calendar.summary },
        }),
      ),
    );
  } catch (syncError) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "success", text: "Google Calendar connected successfully." },
      { type: "warning", text: `Could not fetch calendar list: ${describeError(syncError)}` },
    ]);
  }

  return flashRedirect(request, "/admin/calendar", [
    { type: "success", text: "Google Calendar connected successfully." },
  ]);
}
