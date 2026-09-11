/**
 * Collaboration metrics — work done with (or for) other people.
 *
 * The PR/issue lifecycle figures are parsed out of `ServiceActivity.rawJson`,
 * which stores GitHub's untouched Search-Issues response object for every `pr`
 * and `issue` row (`raw: pr` / `raw: iss` in `@/lib/sources/github`). A real
 * stored row was inspected before this was written, and carries:
 *
 *     state: "closed", closed_at: "2026-08-21T11:53:19Z",
 *     created_at: "2026-08-21T11:49:46Z",
 *     pull_request: { merged_at: "2026-08-21T11:53:19Z", ... }
 *
 * — so merged-vs-closed-unmerged and PR lifetime need no extra API calls.
 * Every read is still optional-chained through `./shared`'s tolerant parsers,
 * and a metric whose inputs never materialise is **omitted from the result
 * rather than reported as zero**: rows fetched before this feature existed, or
 * by a PAT without the `repo` scope, must not be able to turn "we couldn't
 * see it" into "it didn't happen".
 *
 * Pure function, no I/O, never throws.
 */

import { nestedObject, parseIsoDate, parseJsonObject, repoOwner, stringField } from "./shared";
import type { CollaborationStats, GithubStatsRow } from "./types";

/** Event types whose repo can credit the correspondent as an outside contributor. */
const CONTRIBUTING_EVENT_TYPES: ReadonlySet<string> = new Set(["commit", "pr", "review", "issue"]);

const MS_PER_HOUR = 3_600_000;

/** The lifecycle facts a `pr`/`issue` row's `rawJson` can supply, all optional. */
interface LifecycleFacts {
  state: string | null;
  createdAt: Date | null;
  closedAt: Date | null;
  mergedAt: Date | null;
}

/**
 * `merged_at` lives on the `pull_request` sub-object of a Search-Issues hit,
 * not at the top level — the one shape detail worth stating outright, since
 * looking for a top-level `merged_at` silently finds nothing and would make
 * every PR read as "closed without merging".
 */
function lifecycleFacts(row: GithubStatsRow): LifecycleFacts | null {
  const raw = parseJsonObject(row.rawJson);
  if (!raw) return null;
  return {
    state: stringField(raw, "state"),
    createdAt: parseIsoDate(stringField(raw, "created_at")),
    closedAt: parseIsoDate(stringField(raw, "closed_at")),
    mergedAt: parseIsoDate(stringField(nestedObject(raw, "pull_request"), "merged_at")),
  };
}

/**
 * External-repo contributions, PR and issue lifecycle, reviews given and
 * releases published.
 *
 * `username` is the configured `integrations.github.username`; when it is
 * missing, {@link CollaborationStats.externalRepos} is empty rather than
 * guessed, because with no owner to compare against every repo would look
 * external.
 */
export function computeCollaborationStats(
  rows: GithubStatsRow[],
  username: string | undefined,
): CollaborationStats {
  const owner = username?.trim().toLowerCase();
  const externalRepos = new Set<string>();

  let prsOpened = 0;
  let prsMerged = 0;
  let prsClosedUnmerged = 0;
  let prLifecycleSeen = 0;
  let lifetimeHoursTotal = 0;
  let resolvedPrs = 0;
  let issuesOpened = 0;
  let issuesClosed = 0;
  let issueLifecycleSeen = 0;
  let reviewsGiven = 0;
  let releasesPublished = 0;

  for (const row of rows) {
    if (owner && row.repo && CONTRIBUTING_EVENT_TYPES.has(row.eventType)) {
      const rowOwner = repoOwner(row.repo);
      if (rowOwner && rowOwner.toLowerCase() !== owner) externalRepos.add(row.repo);
    }

    switch (row.eventType) {
      case "review":
        reviewsGiven += 1;
        break;
      case "release":
        releasesPublished += 1;
        break;
      case "pr": {
        prsOpened += 1;
        const facts = lifecycleFacts(row);
        if (!facts?.state) break;
        prLifecycleSeen += 1;
        if (facts.mergedAt) prsMerged += 1;
        else if (facts.state === "closed") prsClosedUnmerged += 1;

        const resolvedAt = facts.mergedAt ?? facts.closedAt;
        const openedAt = facts.createdAt ?? row.timestamp;
        if (resolvedAt && openedAt && resolvedAt >= openedAt) {
          lifetimeHoursTotal += (resolvedAt.getTime() - openedAt.getTime()) / MS_PER_HOUR;
          resolvedPrs += 1;
        }
        break;
      }
      case "issue": {
        issuesOpened += 1;
        const facts = lifecycleFacts(row);
        if (!facts?.state) break;
        issueLifecycleSeen += 1;
        if (facts.state === "closed") issuesClosed += 1;
        break;
      }
    }
  }

  const stats: CollaborationStats = {
    externalRepos: [...externalRepos].sort(),
    prsOpened,
    issuesOpened,
    reviewsGiven,
    releasesPublished,
  };

  if (prLifecycleSeen > 0) {
    stats.prsMerged = prsMerged;
    stats.prsClosedUnmerged = prsClosedUnmerged;
  }
  if (resolvedPrs > 0) {
    stats.avgPrLifetimeHours = Math.round((lifetimeHoursTotal / resolvedPrs) * 10) / 10;
  }
  if (issueLifecycleSeen > 0) {
    stats.issuesClosed = issuesClosed;
  }

  return stats;
}
