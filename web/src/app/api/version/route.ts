import { VERSION } from "@/lib/version";

/** `GET /api/version` — what is deployed: `{ version, sha, githubAuth }`. */
export const dynamic = "force-dynamic";

export function GET() {
  // Whether public editions run on the server's own token or anonymously (60 requests/hour per IP).
  return Response.json({ version: VERSION.version, sha: VERSION.sha, githubAuth: process.env.GITHUB_TOKEN ? "token" : "anonymous" });
}
