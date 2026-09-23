/**
 * GitHub activity source. Barrel for `web/src/lib/sources/*`.
 */

export {
  type ActivityItem,
  type ActivitySource,
  type Period,
  beforePeriod,
  inPeriod,
  parseTimestamp,
} from "./types";

export { type GithubFetchOptions, fetchGithubActivity } from "./github";
