/** Ported from `admin.spotify_disconnect` (`app/routes/admin.py:673-687`). */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceToken } from "@/lib/service-token";
import { flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const token = await getServiceToken("spotify");
  if (!token) {
    return flashRedirect(request, "/admin/editions", [
      { type: "info", text: "Spotify was not connected." },
    ]);
  }

  await prisma.serviceToken.delete({ where: { service: "spotify" } });

  return flashRedirect(request, "/admin/editions", [
    { type: "success", text: "Spotify disconnected." },
  ]);
}
