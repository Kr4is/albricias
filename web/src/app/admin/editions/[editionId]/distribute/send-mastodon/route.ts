/** Sends the (possibly edited) copy from the distribute screen to Mastodon. */

import type { NextRequest } from "next/server";
import { postToMastodon } from "@/lib/social/mastodon";
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
    const { url } = await postToMastodon(text);
    return flashRedirect(request, backTo, [
      { type: "success", text: `Posted to Mastodon: ${url}` },
    ]);
  } catch (error) {
    return flashRedirect(request, backTo, [
      { type: "error", text: `Sending to Mastodon failed: ${describeError(error)}` },
    ]);
  }
}
