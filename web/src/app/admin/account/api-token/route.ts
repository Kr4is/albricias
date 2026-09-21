/**
 * Regenerate-API-token action — now a card inside `/admin/settings`
 * (`SettingsPanel.tsx`), not its own page. Writes a fresh random value to
 * the `auth.apiToken` DB setting (encrypted), the only value
 * `src/lib/api-auth.ts`'s `requireApiToken()` checks. The new token is shown
 * once, in the flash message — there is nowhere else to display it.
 */

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { setSetting } from "@/lib/config/settings";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const token = randomBytes(32).toString("base64url");
  await setSetting("auth.apiToken", token, { encrypted: true });

  return flashRedirect(request, "/admin/settings", [
    { type: "success", text: `New API token: ${token} (copy it now — it won't be shown again)` },
  ]);
}
