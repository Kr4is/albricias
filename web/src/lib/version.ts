/**
 * Which build is running: the app's version and the commit it was built from
 * (`GIT_SHA`, passed to the Docker build by CI; `dev` locally).
 */

import pkg from "../../package.json";

const sha = process.env.GIT_SHA || "dev";

export const VERSION = {
  version: pkg.version,
  sha,
  shortSha: sha.slice(0, 7),
  /** The commit on GitHub, or `null` for a local build. */
  commitUrl: /^[0-9a-f]{40}$/i.test(sha) ? `https://github.com/Kr4is/albricias/commit/${sha}` : null,
};
