/** Sends the (possibly edited) copy from the distribute screen to Bluesky. */

import type { NextRequest } from "next/server";
import { postToBluesky } from "@/lib/social/bluesky";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const { editionId } = await params;
  const form = await request.formData();
  const text = String(form.get("text") ?? "").trim();
  const backTo = `/admin/editions/${editionId}/distribute`;

  if (!text) {
    return flashRedirect(request, backTo, [
      { type: "error", text: "Post text cannot be empty." },
    ]);
  }

  try {
    const { url } = await postToBluesky(text);
    return flashRedirect(request, backTo, [
      { type: "success", text: `Posted to Bluesky: ${url}` },
    ]);
  } catch (error) {
    return flashRedirect(request, backTo, [
      { type: "error", text: `Sending to Bluesky failed: ${describeError(error)}` },
    ]);
  }
}
