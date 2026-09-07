/**
 * Set one calendar's mode ("off" | "stats" | "articles" | "both") — the
 * per-calendar privacy control. One `<form>` per row on `/admin/calendar`
 * posts here.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { flashRedirect } from "@/lib/flash";

const VALID_MODES = new Set(["off", "stats", "articles", "both"]);

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const id = Number(form.get("calendar_id"));
  const mode = form.get("mode")?.toString() ?? "";

  if (!Number.isSafeInteger(id) || !VALID_MODES.has(mode)) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: "Invalid calendar or mode." },
    ]);
  }

  const calendar = await prisma.calendarSource.findUnique({ where: { id } });
  if (!calendar) {
    return flashRedirect(request, "/admin/calendar", [
      { type: "error", text: "Calendar not found." },
    ]);
  }

  await prisma.calendarSource.update({ where: { id }, data: { mode } });

  return flashRedirect(request, "/admin/calendar", [
    { type: "success", text: `"${calendar.name}" set to ${mode}.` },
  ]);
}
