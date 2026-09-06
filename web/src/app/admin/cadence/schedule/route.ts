/** POST half of the schedule form at `/admin/cadence` (Phase A / scheduler). */

import cron from "node-cron";
import type { NextRequest } from "next/server";
import { flashRedirect } from "@/lib/flash";
import { registerSchedule, setScheduleSettings } from "@/lib/scheduler";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const cronExpr = form.get("cronExpr")?.toString().trim() ?? "";
  const enabled = form.get("enabled") != null;

  if (enabled && !cron.validate(cronExpr)) {
    return flashRedirect(request, "/admin/cadence", [
      { type: "error", text: `Invalid cron expression: "${cronExpr}".` },
    ]);
  }

  await setScheduleSettings({ cronExpr, enabled });
  await registerSchedule();

  return flashRedirect(request, "/admin/cadence", [
    {
      type: "success",
      text: enabled
        ? `Schedule saved and enabled: "${cronExpr}" (UTC).`
        : "Schedule saved (disabled).",
    },
  ]);
}
