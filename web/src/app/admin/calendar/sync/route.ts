/**
 * Manually re-fetch the connected account's calendar list and upsert
 * `CalendarSource` rows — picks up any calendar created/shared since the last
 * sync. Every newly-seen calendar defaults to `"off"` (the model's default),
 * never touching the mode of a calendar already configured.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidGoogleAccessToken, listCalendars } from "@/lib/sources";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const accessToken = await getValidGoogleAccessToken();
  if (!accessToken) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: "Google Calendar is not connected." },
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
    return flashRedirect(request, "/admin/calendar", [
      { type: "success", text: `Synced ${calendars.length} calendar(s).` },
    ]);
  } catch (error) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: `Calendar sync failed: ${describeError(error)}` },
    ]);
  }
}
