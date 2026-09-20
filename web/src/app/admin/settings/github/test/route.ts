/**
 * "Test connection" for the GitHub settings category — authenticates with
 * the saved token via `GET /user` (the cheapest real call that proves the
 * token is valid and unexpired) and cross-checks the saved username against
 * the account the token actually belongs to, a real and plausible
 * misconfiguration `resolveAiModel`-style presence checks can't catch.
 */

import type { NextRequest } from "next/server";
import { Octokit } from "octokit";
import { getSetting } from "@/lib/config/settings";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  const [token, username] = await Promise.all([
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
  ]);
  if (!token) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: "GitHub token is not configured." },
    ]);
  }

  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.users.getAuthenticated();
    if (username && username !== data.login) {
      return flashRedirect(request, "/admin/settings", [
        {
          type: "warning",
          text: `GitHub token works, but it authenticates as "${data.login}" — the configured username is "${username}".`,
        },
      ]);
    }
    return flashRedirect(request, "/admin/settings", [
      { type: "success", text: `GitHub token works (authenticated as ${data.login}).` },
    ]);
  } catch (error) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: `GitHub connection test failed: ${describeError(error)}` },
    ]);
  }
}
