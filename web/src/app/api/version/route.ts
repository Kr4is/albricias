import { VERSION } from "@/lib/version";

/** `GET /api/version` — what is deployed: `{ version, sha }`. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: VERSION.version, sha: VERSION.sha });
}
