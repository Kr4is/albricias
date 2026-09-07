/**
 * Mirrors `/admin/spotify/disconnect`. Only deletes the `ServiceToken` row —
 * `CalendarSource` rows (and their configured modes) are deliberately left
 * alone so a later reconnect doesn't reset every calendar back to "off".
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceToken } from "@/lib/service-token";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const token = await getServiceToken("google");
  if (!token) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "info", text: "Google Calendar was not connected." },
    ]);
  }

  await prisma.serviceToken.delete({ where: { service: "google" } });

  return flashRedirect(request, "/admin/calendar", [
    { type: "success", text: "Google Calendar disconnected." },
  ]);
}
