/** POST half of the daily-processing schedule form — a card inside `/admin/settings` (`SettingsPanel.tsx`), same shape as `.../cadence/schedule/route.ts`. */

import cron from "node-cron";
import type { NextRequest } from "next/server";
import { flashRedirect } from "@/lib/flash";
import { registerDailySchedule, setDailyScheduleSettings } from "@/lib/scheduler";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const cronExpr = form.get("cronExpr")?.toString().trim() ?? "";
  const enabled = form.get("enabled") != null;

  if (enabled && !cron.validate(cronExpr)) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: `Invalid cron expression: "${cronExpr}".` },
    ]);
  }

  await setDailyScheduleSettings({ cronExpr, enabled });
  await registerDailySchedule();

  return flashRedirect(request, "/admin/settings", [
    {
      type: "success",
      text: enabled
        ? `Daily processing schedule saved and enabled: "${cronExpr}" (UTC).`
        : "Daily processing schedule saved (disabled).",
    },
  ]);
}
