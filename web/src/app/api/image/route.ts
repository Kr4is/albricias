/**
 * The image proxy (`@/lib/image-proxy`): serves a picture the workflow
 * chose — a repository's social image, a README screenshot, a project
 * site's preview — from the app's own origin, so the page can show it and
 * the PNG export can embed it. Only signed URLs, only public https hosts
 * (`safeFetch`), only raster images: an SVG served from this origin could
 * run script if opened directly, so it's refused.
 */

import { verifyImageUrl } from "@/lib/image-proxy";
import { safeFetch } from "@/lib/sources/safe-fetch";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("u");
  const signature = params.get("s");
  if (!target || !signature || !verifyImageUrl(target, signature)) return new Response("Not found", { status: 404 });

  try {
    const image = await safeFetch(target, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 10_000, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" });
    if (!IMAGE_TYPES.has(image.contentType)) return new Response("Not an image", { status: 415 });
    return new Response(image.body as BodyInit, {
      headers: {
        "content-type": image.contentType,
        "cache-control": "public, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.warn(`[image] ${target}: ${error instanceof Error ? error.message : String(error)}`);
    return new Response("Unavailable", { status: 502 });
  }
}
